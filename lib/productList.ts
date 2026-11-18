import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { DEFAULT_EXPIRY_WARNING_DAYS, PERMISSIONS } from "@/lib/constants";
import type { ProductQuery } from "@/lib/productInput";

/**
 * The one implementation of "list the products, filtered and paged".
 *
 * WHY THIS IS A SHARED FUNCTION, NOT JUST A ROUTE
 * -----------------------------------------------
 * Two callers need the exact same answer: `/api/products` (what the client table
 * re-fetches on every search, sort and page change) and the products Server
 * Component (what paints on first load, before any JavaScript runs). If those two
 * disagreed about the shape of a row — a column one selects and the other doesn't,
 * cost stripped in one place but not the other — the table would flicker and
 * change shape the first time the user touched a filter. Keeping the query here,
 * called from both, makes that class of bug impossible rather than merely unlikely.
 *
 * The till never calls this; it syncs the whole catalog by version. This is the
 * back-office list, at human speed.
 */

const SORT_MAP = {
  name: [{ name: "asc" }],
  recent: [{ createdAt: "desc" }],
  price: [{ sellingPriceKobo: "desc" }],
  stock: [{ name: "asc" }],
  expiry: [{ expiryDate: "asc" }],
} as const;

/** A row as the list renders it. Dates stay as `Date`; the JSON edge serialises them. */
export interface ProductListItem {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  unit: string;
  sellingPriceKobo: number;
  wholesalePriceKobo: number;
  /** Present only when the caller holds PRODUCTS_COST_VIEW. */
  costPriceKobo?: number;
  minStock: number;
  trackExpiry: boolean;
  expiryDate: Date | null;
  entryDate: Date | null;
  isActive: boolean;
  version: number;
  imageUrl: string | null;
  department: string;
  category: { id: string; name: string } | null;
  supplier: { id: string; name: string } | null;
  /** Summed across the scoped branch (or every branch for an unscoped admin). */
  quantity: number;
}

export interface ProductListResult {
  items: ProductListItem[];
  page: number;
  perPage: number;
  total: number;
  pages: number;
}

/** Who is allowed to see a cost price — the one gate on the margin. */
export function canSeeCost(user: { role: string; permissions: string[] }): boolean {
  return user.role === "MAIN_ADMIN" || user.permissions.includes(PERMISSIONS.PRODUCTS_COST_VIEW);
}

export async function listProducts(args: {
  orgId: string;
  branchId: string | null;
  user: { role: string; permissions: string[] };
  query: ProductQuery;
}): Promise<ProductListResult> {
  const { orgId, branchId, user, query } = args;
  const { q, categoryId, supplierId, stock, page, perPage, sort, includeInactive } = query;
  // A cashier or storekeeper limited to one department never sees the other,
  // whatever filter they ask for. Everyone else may filter by choice.
  const department = (user as { department?: string | null }).department ?? query.department;

  const where: Prisma.ProductWhereInput = {
    organizationId: orgId,
    ...(department ? { department } : {}),
    ...(includeInactive ? {} : { isActive: true }),
    ...(categoryId ? { categoryId } : {}),
    ...(supplierId ? { supplierId } : {}),
  };

  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { sku: { contains: q, mode: "insensitive" } },
      { barcode: { contains: q } },
    ];
  }

  if (stock) {
    where.id = { in: await productIdsMatchingStock(orgId, branchId, stock) };
  }

  const [total, rows] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      // Explicit select: a Product row carries a ~2KB imageThumb, and this list
      // renders dozens of them. Asking for exactly the columns the table shows
      // keeps the payload a few KB rather than a few hundred. `imageThumb` is
      // deliberately absent — the list shows `imageUrl`, the detail view the thumb.
      select: {
        id: true,
        name: true,
        sku: true,
        barcode: true,
        unit: true,
        sellingPriceKobo: true,
        costPriceKobo: true,
        wholesalePriceKobo: true,
        minStock: true,
        trackExpiry: true,
        expiryDate: true,
        entryDate: true,
        isActive: true,
        version: true,
        imageUrl: true,
        department: true,
        category: { select: { id: true, name: true } },
        supplier: { select: { id: true, name: true } },
        stockLevels: {
          where: { branchId: branchId ?? undefined },
          select: { quantity: true },
        },
      },
      orderBy: [...SORT_MAP[sort]],
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ]);

  const canCost = canSeeCost(user);

  const items: ProductListItem[] = rows.map((row) => {
    const quantity = row.stockLevels.reduce((sum, level) => sum + level.quantity, 0);
    // Cost is stripped here, not merely hidden in the table — a field that is
    // never sent is the only field a reader with devtools genuinely cannot see.
    const { costPriceKobo, stockLevels: _levels, ...rest } = row;
    return {
      ...rest,
      quantity,
      ...(canCost ? { costPriceKobo } : {}),
    };
  });

  return {
    items,
    page,
    perPage,
    total,
    pages: Math.max(1, Math.ceil(total / perPage)),
  };
}

/**
 * Resolve the `stock` filter to a set of product ids.
 *
 * `StockLevel.quantity <= Product.minStock` compares two columns in different
 * tables, which Prisma's `where` cannot express — so the comparison happens in
 * SQL and only the resulting ids cross back. The alternative is reading every
 * product and its levels into memory on every filtered page view.
 *
 * EXPIRING and EXPIRED are ordinary date comparisons and could be Prisma clauses,
 * but they live here so all four filters cost one round trip and the caller has a
 * single `id IN (...)` to build.
 */
export async function productIdsMatchingStock(
  organizationId: string,
  branchId: string | null,
  filter: "LOW" | "OUT" | "EXPIRING" | "EXPIRED",
): Promise<string[]> {
  const branchClause = branchId ? Prisma.sql`AND sl."branchId" = ${branchId}` : Prisma.empty;

  if (filter === "EXPIRING" || filter === "EXPIRED") {
    // EXPIRING means "inside the shop's warning window" — the same definition the
    // dashboard's expiry tile uses — not "any future date". Without the upper
    // bound this filter would list the entire expiry-tracked catalog and the chip
    // beside it would count hundreds of products nobody needs to act on yet. The
    // window is read here rather than passed in so every caller agrees on it
    // without threading the setting through.
    const windowDays =
      filter === "EXPIRING" ? await expiryWindowDays(organizationId) : 0;
    const cutoff = new Date(Date.now() + windowDays * 86_400_000);

    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT p.id
      FROM "Product" p
      WHERE p."organizationId" = ${organizationId}
        AND p."isActive" = true
        AND p."trackExpiry" = true
        AND p."expiryDate" IS NOT NULL
        ${
          filter === "EXPIRED"
            ? Prisma.sql`AND p."expiryDate" < now()`
            : Prisma.sql`AND p."expiryDate" >= now() AND p."expiryDate" <= ${cutoff}`
        }
      LIMIT 5000
    `;
    return rows.map((r) => r.id);
  }

  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT DISTINCT p.id
    FROM "Product" p
    JOIN "StockLevel" sl ON sl."productId" = p.id
    WHERE p."organizationId" = ${organizationId}
      AND p."isActive" = true
      ${branchClause}
      ${
        filter === "OUT"
          ? Prisma.sql`AND sl.quantity <= 0`
          : Prisma.sql`AND p."minStock" > 0 AND sl.quantity <= p."minStock" AND sl.quantity > 0`
      }
    LIMIT 5000
  `;
  return rows.map((r) => r.id);
}

/** Days before expiry a product starts warning. One shop-wide setting, one default. */
async function expiryWindowDays(organizationId: string): Promise<number> {
  const settings = await prisma.orgSettings.findUnique({
    where: { organizationId },
    select: { expiryWarningDays: true },
  });
  return settings?.expiryWarningDays ?? DEFAULT_EXPIRY_WARNING_DAYS;
}
