import { NextResponse } from "next/server";

import { AppError, handle } from "@/lib/api";
import { prisma } from "@/lib/db";
import { requireTenantApi } from "@/lib/auth";
import { requirePermission } from "@/lib/permissions";
import { PERMISSIONS } from "@/lib/constants";
import { formatNaira } from "@/lib/money";
import { bumpCatalogVersion } from "@/lib/catalog";
import { Prisma } from "@prisma/client";

import {
  canSeeCost,
  assertBarcodeFree,
  validCategoryId,
  validSupplierId,
} from "../route";
import { parseProductPatch, readBody } from "@/lib/productParse";
import { productBusinessRules } from "@/lib/productInput";

/**
 * One product: read it, edit it, retire it.
 *
 * The edit and delete paths both touch the catalog, so both bump the version and
 * both leave an audit row — a price change is the single most argued-about edit
 * in a shop ("this was ₦500 yesterday"), and the trail is what settles it.
 */

export async function GET(
  request: Request,
  context: RouteContext<"/api/products/[id]">,
) {
  return handle(async () => {
    const session = await requireTenantApi();
    requirePermission(session.user, PERMISSIONS.PRODUCTS_VIEW);
    const { id } = await context.params;

    const product = await prisma.product.findFirst({
      // organizationId in the WHERE, not just the id: an id from a URL must never
      // be enough to read across tenants.
      where: {
        id,
        organizationId: session.org.id,
        // Limited to one department? The other department's products don't exist.
        ...(session.user.department ? { department: session.user.department } : {}),
      },
      select: {
        id: true,
        name: true,
        sku: true,
        barcode: true,
        description: true,
        unit: true,
        packSize: true,
        sellingPriceKobo: true,
        costPriceKobo: true,
        wholesalePriceKobo: true,
        wholesaleMinQty: true,
        minStock: true,
        trackExpiry: true,
        expiryDate: true,
        entryDate: true,
        imageUrl: true,
        imageThumb: true,
        isActive: true,
        version: true,
        createdAt: true,
        updatedAt: true,
        category: { select: { id: true, name: true } },
        supplier: { select: { id: true, name: true, marketName: true } },
        stockLevels: {
          select: {
            quantity: true,
            lastMovementAt: true,
            lastCountedAt: true,
            branch: { select: { id: true, name: true, code: true } },
          },
        },
      },
    });

    if (!product) {
      throw new AppError("That product doesn't exist.", { status: 404 });
    }

    // The edit page wants recent history so the person can see *why* a figure is
    // what it is before they change it. Capped — the full ledger lives behind the
    // stock screen, this is just the last handful.
    const movements = await prisma.stockMovement.findMany({
      where: { organizationId: session.org.id, productId: id },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        type: true,
        quantity: true,
        balanceAfter: true,
        reason: true,
        createdAt: true,
        user: { select: { name: true } },
      },
    });

    const quantity = product.stockLevels.reduce((sum, l) => sum + l.quantity, 0);
    const { costPriceKobo, ...rest } = product;

    return NextResponse.json({
      product: {
        ...rest,
        quantity,
        movements,
        ...(canSeeCost(session.user) ? { costPriceKobo } : {}),
      },
    });
  });
}

/**
 * PATCH — edit the product. The form sends the whole set of fields it owns, so in
 * practice this is a full update of those columns; a lighter caller (an inline
 * price edit from the table) can send just `{ sellingPrice }` and nothing else is
 * touched. Absent keys are left alone; that distinction is the whole reason this
 * is a PATCH and not a PUT.
 */
export async function PATCH(
  request: Request,
  context: RouteContext<"/api/products/[id]">,
) {
  return handle(async () => {
    const session = await requireTenantApi();
    requirePermission(session.user, PERMISSIONS.PRODUCTS_EDIT);
    const { id } = await context.params;

    const raw = await readBody(request);
    const parsed = parseProductPatch(raw);

    const existing = await prisma.product.findFirst({
      where: {
        id,
        organizationId: session.org.id,
        // Limited to one department? The other department's products don't exist.
        ...(session.user.department ? { department: session.user.department } : {}),
      },
      select: {
        id: true,
        name: true,
        sku: true,
        barcode: true,
        costPriceKobo: true,
        sellingPriceKobo: true,
        wholesalePriceKobo: true,
        trackExpiry: true,
        expiryDate: true,
        isActive: true,
        retiredBarcode: true,
      },
    });
    if (!existing) {
      throw new AppError("That product doesn't exist.", { status: 404 });
    }

    // Business rules need the *effective* figures — the patch laid over what's
    // already stored — or a rule like "wholesale above retail" can't fire when
    // only one of the two prices is in the patch.
    const effective = {
      name: parsed.name ?? existing.name,
      costPrice: parsed.costPrice ?? existing.costPriceKobo,
      sellingPrice: parsed.sellingPrice ?? existing.sellingPriceKobo,
      wholesalePrice: parsed.wholesalePrice ?? existing.wholesalePriceKobo,
      trackExpiry: parsed.trackExpiry ?? existing.trackExpiry,
      expiryDate:
        parsed.expiryDate !== undefined ? parsed.expiryDate : existing.expiryDate,
    };
    const problems = productBusinessRules(effective);
    if (Object.keys(problems).length > 0) {
      throw new AppError("Check the highlighted fields.", { status: 422, fields: problems });
    }

    // Build the write from only the keys that were actually sent. A field left
    // out of the body is a field the caller isn't touching.
    const data: Prisma.ProductUpdateInput = {};
    if (parsed.name !== undefined) data.name = parsed.name;
    // SKU is NOT NULL and unique — an empty SKU means "don't change it", never
    // "blank it". Barcode, which is nullable, genuinely can be cleared.
    if (parsed.sku) data.sku = parsed.sku;
    if (parsed.barcode !== undefined) data.barcode = parsed.barcode;
    if (parsed.description !== undefined) data.description = parsed.description;
    if (parsed.unit !== undefined) data.unit = parsed.unit;
    if (parsed.packSize !== undefined) data.packSize = parsed.packSize;
    if (parsed.costPrice !== undefined) data.costPriceKobo = parsed.costPrice;
    if (parsed.sellingPrice !== undefined) data.sellingPriceKobo = parsed.sellingPrice;
    if (parsed.wholesalePrice !== undefined) data.wholesalePriceKobo = parsed.wholesalePrice;
    if (parsed.wholesaleMinQty !== undefined) data.wholesaleMinQty = parsed.wholesaleMinQty;
    if (parsed.minStock !== undefined) data.minStock = parsed.minStock;
    if (parsed.imageUrl !== undefined) data.imageUrl = parsed.imageUrl;
    if (parsed.imageThumb !== undefined) data.imageThumb = parsed.imageThumb;

    // Expiry tracking and the date are coupled: turning tracking off clears the
    // date (so the product leaves the expiry sweep), and a date only persists
    // when tracking is actually on.
    if (parsed.trackExpiry !== undefined) {
      data.trackExpiry = parsed.trackExpiry;
      if (!parsed.trackExpiry) data.expiryDate = null;
    }
    if (parsed.expiryDate !== undefined) {
      data.expiryDate = effective.trackExpiry ? parsed.expiryDate : null;
    }

    // Category / supplier arrive as ids and must belong to this org, or be nulled.
    if (parsed.department !== undefined && !session.user.department) {
      data.department = parsed.department;
    }
    if (parsed.categoryId !== undefined) {
      data.category = parsed.categoryId
        ? { connect: { id: await requireOwnedCategory(session.org.id, parsed.categoryId) } }
        : { disconnect: true };
    }
    if (parsed.supplierId !== undefined) {
      data.supplier = parsed.supplierId
        ? { connect: { id: await requireOwnedSupplier(session.org.id, parsed.supplierId) } }
        : { disconnect: true };
    }

    // Reactivation / deactivation can ride along on the same PATCH (the table's
    // active toggle). Read straight off the raw body — it isn't a product field
    // the shared schema should carry into *create*.
    const activeToggle =
      raw && typeof raw === "object" && typeof (raw as Record<string, unknown>).isActive === "boolean"
        ? ((raw as Record<string, unknown>).isActive as boolean)
        : undefined;
    if (activeToggle !== undefined) data.isActive = activeToggle;

    // Deleting frees the barcode so another product can use it; restoring
    // brings it back, unless another product has taken it in the meantime.
    let barcodeNote: string | undefined;
    if (activeToggle === false && existing.isActive && existing.barcode && parsed.barcode === undefined) {
      data.barcode = null;
      data.retiredBarcode = existing.barcode;
    }
    if (activeToggle === true && !existing.isActive && existing.retiredBarcode && !existing.barcode && parsed.barcode === undefined) {
      const taker = await prisma.product.findFirst({
        where: { organizationId: session.org.id, barcode: existing.retiredBarcode, id: { not: id } },
        select: { name: true },
      });
      if (taker) {
        barcodeNote = `Restored without its old barcode: ${taker.name} uses ${existing.retiredBarcode} now.`;
      } else {
        data.barcode = existing.retiredBarcode;
      }
      data.retiredBarcode = null;
    }

    // Barcode uniqueness: cheap pre-check for a friendly message; the DB unique
    // index is the real guarantee and lib/api.ts turns its P2002 into the same
    // 409 if two edits race.
    if (parsed.barcode) {
      await assertBarcodeFree(session.org.id, parsed.barcode, id);
    }

    if (Object.keys(data).length === 0) {
      // Nothing to change — don't bump the catalog or write an audit row for a
      // no-op, or every "save" with no edits resyncs every till for nothing.
      return NextResponse.json({ ok: true, unchanged: true });
    }

    const version = await prisma.$transaction(async (tx) => {
      const nextVersion = await bumpCatalogVersion(session.org.id, tx);
      const result = await tx.product.updateMany({
        // Scoped write: id AND organizationId. A bare `update` by id is one typo
        // in a future refactor away from editing another shop's product.
        where: {
        id,
        organizationId: session.org.id,
        // Limited to one department? The other department's products don't exist.
        ...(session.user.department ? { department: session.user.department } : {}),
      },
        data: { ...data, version: nextVersion },
      });
      if (result.count === 0) {
        throw new AppError("That product doesn't exist.", { status: 404 });
      }
      return nextVersion;
    });

    await writeEditAudit(session, id, existing, data);

    return NextResponse.json({ ok: true, version, ...(barcodeNote ? { note: barcodeNote } : {}) });
  });
}

/**
 * DELETE — soft. A product that has ever been sold cannot be truly deleted: its
 * `SaleItem` rows snapshot the name and price, but the stock history, the
 * purchases and the audit trail all point at this row, and ripping it out turns
 * three months of reports into orphans. Deactivating drops it from every till on
 * the next sync and hides it from the list, which is what "delete" means to a
 * shopkeeper anyway.
 */
export async function DELETE(
  request: Request,
  context: RouteContext<"/api/products/[id]">,
) {
  return handle(async () => {
    const session = await requireTenantApi();
    requirePermission(session.user, PERMISSIONS.PRODUCTS_DELETE);
    const { id } = await context.params;

    const product = await prisma.product.findFirst({
      where: {
        id,
        organizationId: session.org.id,
        // Limited to one department? The other department's products don't exist.
        ...(session.user.department ? { department: session.user.department } : {}),
      },
      select: { id: true, name: true, sku: true, isActive: true, barcode: true },
    });
    if (!product) {
      throw new AppError("That product doesn't exist.", { status: 404 });
    }
    if (!product.isActive) {
      // Already gone. Idempotent — a double-click on the delete button is not an
      // error worth showing.
      return NextResponse.json({ ok: true, alreadyInactive: true });
    }

    await prisma.$transaction(async (tx) => {
      const nextVersion = await bumpCatalogVersion(session.org.id, tx);
      await tx.product.updateMany({
        where: {
        id,
        organizationId: session.org.id,
        // Limited to one department? The other department's products don't exist.
        ...(session.user.department ? { department: session.user.department } : {}),
      },
        // Free the barcode: the product is gone from the shop, so the code can
        // go on a new product. It is kept in retiredBarcode for a restore.
        data: {
          isActive: false,
          version: nextVersion,
          ...(product.barcode ? { barcode: null, retiredBarcode: product.barcode } : {}),
        },
      });
    });

    await prisma.auditLog
      .create({
        data: {
          organizationId: session.org.id,
          userId: session.user.id,
          userName: session.user.name,
          action: "PRODUCT_DEACTIVATED",
          entity: "Product",
          entityId: id,
          summary: `Deactivated ${product.name} (${product.sku}).`,
        },
      })
      .catch((error) => {
        console.error("[products/[id]] audit write failed:", error);
      });

    return NextResponse.json({ ok: true });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Like `validCategoryId` but a non-owned id is a 404, not a silent null — an
 *  edit naming someone else's category should fail loudly, not quietly detach. */
async function requireOwnedCategory(organizationId: string, categoryId: string): Promise<string> {
  const ok = await validCategoryId(prisma, organizationId, categoryId);
  if (!ok) throw new AppError("That category doesn't exist.", { status: 400, fields: { categoryId: "Unknown category" } });
  return ok;
}

async function requireOwnedSupplier(organizationId: string, supplierId: string): Promise<string> {
  const ok = await validSupplierId(prisma, organizationId, supplierId);
  if (!ok) throw new AppError("That supplier doesn't exist.", { status: 400, fields: { supplierId: "Unknown supplier" } });
  return ok;
}

/**
 * Record what changed, in the shopkeeper's words. Price changes get their own
 * action and a before→after line because that is the edit people come looking
 * for; everything else is summarised as the list of fields touched.
 */
async function writeEditAudit(
  session: { org: { id: string }; user: { id: string; name: string } },
  productId: string,
  before: {
    name: string;
    costPriceKobo: number;
    sellingPriceKobo: number;
    wholesalePriceKobo: number;
  },
  data: Prisma.ProductUpdateInput,
): Promise<void> {
  const priceLines: string[] = [];
  if (typeof data.sellingPriceKobo === "number" && data.sellingPriceKobo !== before.sellingPriceKobo) {
    priceLines.push(`retail ${formatNaira(before.sellingPriceKobo)} → ${formatNaira(data.sellingPriceKobo)}`);
  }
  if (typeof data.costPriceKobo === "number" && data.costPriceKobo !== before.costPriceKobo) {
    priceLines.push(`cost ${formatNaira(before.costPriceKobo)} → ${formatNaira(data.costPriceKobo)}`);
  }
  if (typeof data.wholesalePriceKobo === "number" && data.wholesalePriceKobo !== before.wholesalePriceKobo) {
    priceLines.push(`wholesale ${formatNaira(before.wholesalePriceKobo)} → ${formatNaira(data.wholesalePriceKobo)}`);
  }

  const action = priceLines.length > 0 ? "PRICE_CHANGED" : "PRODUCT_UPDATED";
  const summary =
    priceLines.length > 0
      ? `${before.name}: ${priceLines.join(", ")}.`
      : `Edited ${before.name}.`;

  await prisma.auditLog
    .create({
      data: {
        organizationId: session.org.id,
        userId: session.user.id,
        userName: session.user.name,
        action,
        entity: "Product",
        entityId: productId,
        summary,
        beforeJson: priceLines.length > 0 ? JSON.stringify({
          costPriceKobo: before.costPriceKobo,
          sellingPriceKobo: before.sellingPriceKobo,
          wholesalePriceKobo: before.wholesalePriceKobo,
        }) : null,
      },
    })
    .catch((error) => {
      console.error("[products/[id]] audit write failed:", error);
    });
}
