import { NextResponse } from "next/server";

import { AppError, handle } from "@/lib/api";
import { prisma } from "@/lib/db";
import { requireTenantApi } from "@/lib/auth";
import { requirePermission } from "@/lib/permissions";
import { PERMISSIONS } from "@/lib/constants";
import { bumpCatalogVersion } from "@/lib/catalog";
import { generateSku } from "@/lib/sequence";
import { applyMovement } from "@/lib/stock";
import { Prisma } from "@prisma/client";
import { listProducts } from "@/lib/productList";
import { productBusinessRules } from "@/lib/productInput";
import { parseQuery, parseProduct, readBody } from "@/lib/productParse";

/**
 * GET /api/products — the product list, filtered and paged.
 *
 * The query itself lives in lib/productList.ts and is called from here *and* from
 * the products Server Component, so the first server-rendered paint and every
 * later client re-fetch return byte-identical rows — same columns, same cost
 * gating, same shape. If the two drifted, the table would change shape the first
 * time the user touched a filter. This route is only the HTTP skin around that:
 * authenticate, parse the query string, delegate, serialise.
 *
 * WHY THIS IS NOT THE POS ENDPOINT
 * --------------------------------
 * The till never calls this. It holds the whole catalog in IndexedDB and syncs
 * deltas against `Organization.catalogVersion` (see lib/catalog.ts). This is the
 * back-office list: human-speed paging with filters, where a round trip per
 * search is fine.
 */
export async function GET(request: Request) {
  return handle(async () => {
    const session = await requireTenantApi();
    requirePermission(session.user, PERMISSIONS.PRODUCTS_VIEW);

    const url = new URL(request.url);
    const query = parseQuery(Object.fromEntries(url.searchParams));

    const result = await listProducts({
      orgId: session.org.id,
      branchId: session.branch?.id ?? null,
      user: session.user,
      query,
    });

    return NextResponse.json(result);
  });
}

/**
 * POST /api/products — create one product.
 *
 * The opening quantity is applied through the ledger rather than written to
 * `StockLevel` directly, so the very first row of a product's history is a real
 * movement with a reason. A product that starts life as a bare quantity with no
 * movement behind it can never be reconciled against a count.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const session = await requireTenantApi();
    requirePermission(session.user, PERMISSIONS.PRODUCTS_CREATE);

    if (!session.branch) {
      throw new AppError(
        "Your account isn't attached to a shop branch, so there's nowhere to put the stock.",
        { status: 400 },
      );
    }

    const raw = await readBody(request);
    const parsed = parseProduct(raw);
    const problems = productBusinessRules(parsed);

    if (Object.keys(problems).length > 0) {
      throw new AppError("Check the highlighted fields.", { status: 422, fields: problems });
    }

    const sku = parsed.sku ?? uniqueSku(parsed.name);
    await assertBarcodeFree(session.org.id, parsed.barcode, null);

    const product = await prisma.$transaction(async (tx) => {
      // Bump FIRST, then stamp the row with the number it returns. The tills ask
      // for `version > (what I hold)`; a product written at the default version 1
      // while the catalog is already at 40 is a product every till silently skips.
      // Stamping it with the freshly-bumped version is what makes it show up on
      // the next sync. Price and version must also move together — a till that
      // syncs between the write and the bump would otherwise miss the change.
      const version = await bumpCatalogVersion(session.org.id, tx);

      const created = await tx.product.create({
        data: {
          organizationId: session.org.id,
          categoryId: await validCategoryId(tx, session.org.id, parsed.categoryId),
          // Someone limited to one department can only add to that department.
          department: session.user.department ?? parsed.department ?? "SUPERMARKET",
          supplierId: await validSupplierId(tx, session.org.id, parsed.supplierId),
          name: parsed.name,
          sku,
          barcode: parsed.barcode,
          description: parsed.description,
          unit: parsed.unit,
          packSize: parsed.packSize,
          costPriceKobo: parsed.costPrice,
          sellingPriceKobo: parsed.sellingPrice,
          wholesalePriceKobo: parsed.wholesalePrice,
          wholesaleMinQty: parsed.wholesaleMinQty,
          minStock: parsed.minStock,
          trackExpiry: parsed.trackExpiry,
          expiryDate: parsed.trackExpiry ? parsed.expiryDate : null,
          imageUrl: parsed.imageUrl,
          imageThumb: parsed.imageThumb,
          version,
          createdById: session.user.id,
        },
        select: { id: true, name: true, sku: true, version: true },
      });

      if (parsed.openingStock && parsed.openingStock > 0) {
        await applyMovement(
          tx,
          {
            organizationId: session.org.id,
            branchId: session.branch!.id,
            productId: created.id,
            quantity: parsed.openingStock,
            type: "OPENING",
            unitCostKobo: parsed.costPrice,
            referenceType: "MANUAL",
            reason: "Opening stock entered with the product",
            userId: session.user.id,
            batch: parsed.trackExpiry && parsed.expiryDate ? { expiryDate: parsed.expiryDate, source: "OPENING" } : null,
          },
          { allowNegative: false },
        );
      }

      return created;
    });

    return NextResponse.json({ ok: true, product }, { status: 201 });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** A SKU nobody else in this shop is using. */
export function uniqueSku(name: string): string {
  // `generateSku` already appends a random 4-digit suffix; the timestamp-free
  // form keeps SKUs stable-looking rather than sequential.
  return generateSku(name);
}

/** Reject a barcode another product already carries, naming the product. */
export async function assertBarcodeFree(
  organizationId: string,
  barcode: string | null | undefined,
  excludeProductId: string | null,
): Promise<void> {
  if (!barcode) return;
  const clash = await prisma.product.findFirst({
    where: {
      organizationId,
      barcode,
      ...(excludeProductId ? { id: { not: excludeProductId } } : {}),
    },
    select: { name: true, sku: true },
  });
  if (clash) {
    throw new AppError(`${clash.name} (${clash.sku}) already uses that barcode.`, {
      status: 409,
      fields: { barcode: "Already used by another product" },
    });
  }
}

/** Null out a category id that doesn't belong to this organization. */
export async function validCategoryId(
  tx: Prisma.TransactionClient,
  organizationId: string,
  categoryId: string | null,
): Promise<string | null> {
  if (!categoryId) return null;
  const found = await tx.category.findFirst({
    where: { id: categoryId, organizationId },
    select: { id: true },
  });
  return found?.id ?? null;
}

export async function validSupplierId(
  tx: Prisma.TransactionClient,
  organizationId: string,
  supplierId: string | null,
): Promise<string | null> {
  if (!supplierId) return null;
  const found = await tx.supplier.findFirst({
    where: { id: supplierId, organizationId },
    select: { id: true },
  });
  return found?.id ?? null;
}

// The cost gate and the parse edge each have exactly one implementation; the
// [id], lookup and import routes import them from here so there is never a second
// copy to drift. (Two money parsers is two chances to disagree about "1,250.50".)
export { canSeeCost } from "@/lib/productList";
export { parseQuery, parseProduct, parseProductPatch, readBody } from "@/lib/productParse";
