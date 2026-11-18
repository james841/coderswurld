import { prisma } from "@/lib/db";
import { requireTenant } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { PERMISSIONS } from "@/lib/constants";
import { canSeeCost, listProducts, productIdsMatchingStock } from "@/lib/productList";
import { ProductQuerySchema } from "@/lib/productInput";

import { PageHeader } from "@/components/ui/PageHeader";
import { NoAccess } from "@/components/ui/NoAccess";
import { ProductsTable } from "./ProductsTable";

/**
 * The product list — server-rendered on the first paint.
 *
 * WHY THIS IS A SERVER COMPONENT THAT QUERIES DIRECTLY
 * ---------------------------------------------------
 * The table is the busiest screen in the back office, so the first paint has to
 * arrive with rows already in it. This component runs the *same* `listProducts`
 * the API route runs and hands the serialized rows to the client table as props
 * — no fetch, no spinner, no empty flash on a page a shopkeeper opens fifty
 * times a day. The client table only calls the API for *subsequent* changes
 * (search, filter, page). One query implementation, two entry points, identical
 * rows.
 *
 * The five chip counts are computed here too, so they reflect the whole catalog
 * and not just the page on screen — "12 low" means twelve, not "however many are
 * low out of these twenty-five".
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "Products" };

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireTenant();
  const { org, user, branch } = session;

  if (!hasPermission(user, PERMISSIONS.PRODUCTS_VIEW)) {
    return <NoAccess what="products" />;
  }

  const params = await searchParams;
  const query = parseListQuery(params);
  const branchId = branch?.id ?? null;

  const [result, categories, suppliers, allCount, lowIds, outIds, expiringIds, expiredIds, settings] =
    await Promise.all([
      listProducts({ orgId: org.id, branchId, user, query }),
      prisma.category.findMany({
        where: { organizationId: org.id, isActive: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: { id: true, name: true },
      }),
      prisma.supplier.findMany({
        where: { organizationId: org.id, isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      prisma.product.count({ where: { organizationId: org.id, isActive: true } }),
      productIdsMatchingStock(org.id, branchId, "LOW"),
      productIdsMatchingStock(org.id, branchId, "OUT"),
      productIdsMatchingStock(org.id, branchId, "EXPIRING"),
      productIdsMatchingStock(org.id, branchId, "EXPIRED"),
      prisma.orgSettings.findUnique({
        where: { organizationId: org.id },
        select: { expiryWarningDays: true, departmentsEnabled: true },
      }),
    ]);

  return (
    <>
      <PageHeader
        title="Products"
        subtitle={`${allCount.toLocaleString("en-NG")} item${allCount === 1 ? "" : "s"} in your catalog`}
        action={
          <>
            {hasPermission(user, PERMISSIONS.PRODUCTS_IMPORT) && (
              <a href="/products/import" className="btn btn-outline">
                Import from Excel
              </a>
            )}
            {hasPermission(user, PERMISSIONS.PRODUCTS_CREATE) && (
              <a href="/products/add" className="btn btn-primary">
                Add product
              </a>
            )}
          </>
        }
      />
      <ProductsTable
        departments={settings?.departmentsEnabled ? { locked: user.department } : undefined}
        initial={{
          items: result.items.map((item) => ({
            ...item,
            // Dates have to cross the server/client boundary as strings; Prisma
            // hands us Date objects and React cannot serialize those into props.
            expiryDate: item.expiryDate ? item.expiryDate.toISOString() : null,
            entryDate: item.entryDate ? item.entryDate.toISOString() : null,
          })),
          page: result.page,
          perPage: result.perPage,
          total: result.total,
          pages: result.pages,
        }}
        initialQuery={query}
        categories={categories}
        suppliers={suppliers}
        counts={{
          all: allCount,
          low: lowIds.length,
          out: outIds.length,
          expiring: expiringIds.length,
          expired: expiredIds.length,
        }}
        can={{
          edit: hasPermission(user, PERMISSIONS.PRODUCTS_EDIT),
          delete: hasPermission(user, PERMISSIONS.PRODUCTS_DELETE),
          cost: canSeeCost(user),
          barcode: hasPermission(user, PERMISSIONS.PRODUCTS_BARCODE),
        }}
        expiryWarningDays={
          settings?.expiryWarningDays ?? 90
        }
      />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Query parsing
// ─────────────────────────────────────────────────────────────────────────────

/** One value per key. Next.js hands back arrays for repeated params; take the first. */
function flatten(
  params: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    const single = Array.isArray(value) ? value[0] : value;
    if (single !== undefined && single !== "") out[key] = single;
  }
  return out;
}

/**
 * The dashboard deep-links with `?filter=expired|expiring|out|low`, but the API
 * query is `?stock=EXPIRED|EXPIRING|OUT|LOW`. This is the one place the two
 * vocabularies meet, so every chip on the dashboard and the URL here agree.
 */
const FILTER_TO_STOCK: Record<string, string> = {
  low: "LOW",
  out: "OUT",
  expiring: "EXPIRING",
  expired: "EXPIRED",
};

/**
 * Deliberately `safeParse`, not `parse`. A hand-edited or stale URL must not
 * throw a 500 out of a Server Component — an unrecognised param falls back to
 * the defaults and the shopkeeper simply gets the full list.
 *
 * `parse({})` is the fallback *because* it applies the schema's own defaults
 * (sort "recent", page 1, perPage 25, includeInactive false). Hardcoding a
 * fallback object here would be a second copy of those defaults waiting to
 * drift from the schema.
 */
function parseListQuery(params: Record<string, string | string[] | undefined>) {
  const flat = flatten(params);

  if (flat.filter && !flat.stock && FILTER_TO_STOCK[flat.filter]) {
    flat.stock = FILTER_TO_STOCK[flat.filter];
  }

  const result = ProductQuerySchema.safeParse(flat);
  return result.success ? result.data : ProductQuerySchema.parse({});
}
