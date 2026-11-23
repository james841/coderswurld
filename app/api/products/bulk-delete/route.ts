import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError, handle, readJson } from "@/lib/api";
import { prisma } from "@/lib/db";
import { requireTenantApi } from "@/lib/auth";
import { requirePermission } from "@/lib/permissions";
import { PERMISSIONS } from "@/lib/constants";
import { bumpCatalogVersion } from "@/lib/catalog";
import { productListWhere } from "@/lib/productList";
import { ProductQuerySchema } from "@/lib/productInput";
import type { Prisma } from "@prisma/client";

/**
 * POST /api/products/bulk-delete: remove many products at once.
 *
 * Two ways to say which:
 *  - { ids: [...] }  the products ticked in the list (up to 2,000);
 *  - { all: true, query: {...} }  every product matching the list's current
 *    filters, so "select all" can reach past the page on screen. The filter is
 *    the list's own (productListWhere), so it removes exactly what was shown.
 *
 * "Delete" works exactly like the single delete: the product is switched off
 * (hidden from the till and the list, sales history kept, restorable) and its
 * barcode is freed for a new product, kept in retiredBarcode for a restore.
 * Done in chunks so a few thousand products finish well inside the time limit.
 */
const BodySchema = z.union([
  z.object({ ids: z.array(z.string().min(1).max(40)).min(1).max(2000) }),
  z.object({ all: z.literal(true), query: ProductQuerySchema.partial().default({}) }),
]);

const CHUNK = 2000;

export async function POST(request: Request) {
  return handle(async () => {
    const session = await requireTenantApi();
    requirePermission(session.user, PERMISSIONS.PRODUCTS_DELETE);

    const parsed = BodySchema.safeParse(await readJson(request));
    if (!parsed.success) {
      throw new AppError("Choose at least one product to delete.", { status: 400 });
    }
    const body = parsed.data;
    const orgId = session.org.id;

    let where: Prisma.ProductWhereInput;
    if ("ids" in body) {
      where = {
        organizationId: orgId,
        id: { in: body.ids },
        // Limited to one department? The other department's products don't exist.
        ...(session.user.department ? { department: session.user.department } : {}),
      };
    } else {
      where = await productListWhere({
        orgId,
        branchId: session.branch?.id ?? null,
        user: session.user,
        query: ProductQuerySchema.parse({ ...body.query, includeInactive: false }),
      });
    }

    // Only products still on sale; already-removed ones are simply skipped.
    const targets = await prisma.product.findMany({
      where: { AND: [where, { isActive: true }] },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    if (targets.length === 0) {
      return NextResponse.json({ ok: true, removed: 0 });
    }

    // One catalog version for the whole batch: every till drops them all on its
    // next sync.
    const version = await bumpCatalogVersion(orgId);
    let removed = 0;
    for (let i = 0; i < targets.length; i += CHUNK) {
      const ids = targets.slice(i, i + CHUNK).map((t) => t.id);
      removed += await prisma.$executeRaw`
        UPDATE "Product"
        SET "isActive" = false,
            "retiredBarcode" = COALESCE("barcode", "retiredBarcode"),
            "barcode" = NULL,
            "version" = ${version},
            "updatedAt" = NOW()
        WHERE "organizationId" = ${orgId}
          AND "isActive" = true
          AND "id" = ANY(${ids}::text[])
      `;
    }

    const sample = targets
      .slice(0, 5)
      .map((t) => t.name)
      .join(", ");
    await prisma.auditLog
      .create({
        data: {
          organizationId: orgId,
          userId: session.user.id,
          userName: session.user.name,
          action: "PRODUCTS_BULK_DEACTIVATED",
          entity: "Product",
          entityId: targets[0].id,
          summary: `Removed ${removed} product${removed === 1 ? "" : "s"} at once: ${sample}${
            targets.length > 5 ? ` and ${targets.length - 5} more` : ""
          }.`,
        },
      })
      .catch((error) => {
        console.error("[products/bulk-delete] audit write failed:", error);
      });

    return NextResponse.json({ ok: true, removed });
  });
}
