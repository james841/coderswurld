import { Boxes } from "lucide-react";
import Link from "next/link";

import { prisma } from "@/lib/db";
import { requireTenant } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { PERMISSIONS, SEES_ALL_DEPARTMENTS } from "@/lib/constants";

import { PageHeader } from "@/components/ui/PageHeader";
import { NoAccess } from "@/components/ui/NoAccess";
import { EmptyState } from "@/components/ui/EmptyState";
import { pinnedBranch } from "@/lib/branchScope";
import { ExportStockButton } from "./ExportStockButton";
import { StockClient, type StockRow } from "./StockClient";

/**
 * Stock levels — what's on the shelf, right now, at one branch.
 *
 * The whole active catalogue and its on-hand figures come down in a single lean
 * query (identity, min level, quantity — no prices, no images), so the client can
 * search and triage low/out stock the instant the page paints, with no second
 * request and no scrolling-loads. That lean shape is deliberate: this screen is
 * about counts, not money, and a mini-mart's thousand SKUs stay a small payload
 * when every row is five short columns.
 *
 * Adjustments move stock but never the catalogue, so there's no version to bump
 * here — see the stock ledger in lib/stock.
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "Stock" };

const MAX_ROWS = 5000;

export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireTenant();
  const { org, user, branch } = session;

  if (!hasPermission(user, PERMISSIONS.STOCK_VIEW)) {
    return <NoAccess what="stock levels" />;
  }

  const params = await searchParams;
  const filterParam = typeof params.filter === "string" ? params.filter : undefined;
  const initialFilter: "all" | "low" | "out" =
    filterParam === "low" || filterParam === "out" ? filterParam : "all";

  const branches = await prisma.branch.findMany({
    where: { organizationId: org.id, isActive: true },
    orderBy: [{ isMain: "desc" }, { name: "asc" }],
    select: { id: true, name: true, code: true, isMain: true },
  });

  // Resolve a concrete branch — adjustments can't target "all branches". A branch
  // the session is pinned to wins; an org-wide admin lands on main and can switch.
  const requested = typeof params.branch === "string" ? params.branch : undefined;
  const selectedBranchId =
    (requested && branches.some((b) => b.id === requested) ? requested : undefined) ??
    branch?.id ??
    branches.find((b) => b.isMain)?.id ??
    branches[0]?.id ??
    "";

  const products = selectedBranchId
    ? await prisma.product.findMany({
        where: {
          organizationId: org.id,
          isActive: true,
          // Staff tied to one counter only see that counter's stock.
          ...(user.department ? { department: user.department } : {}),
        },
        orderBy: { name: "asc" },
        take: MAX_ROWS,
        select: {
          id: true,
          name: true,
          sku: true,
          unit: true,
          minStock: true,
          trackExpiry: true,
          expiryDate: true,
          stockLevels: {
            where: { branchId: selectedBranchId },
            select: { quantity: true, lastCountedAt: true },
          },
        },
      })
    : [];

  const rows: StockRow[] = products.map((p) => {
    const level = p.stockLevels[0];
    return {
      productId: p.id,
      name: p.name,
      sku: p.sku,
      unit: p.unit,
      quantity: level?.quantity ?? 0,
      minStock: p.minStock,
      trackExpiry: p.trackExpiry,
      expiryDate: p.expiryDate ? p.expiryDate.toISOString() : null,
      lastCountedAt: level?.lastCountedAt ? level.lastCountedAt.toISOString() : null,
    };
  });

  const selectedBranch = branches.find((b) => b.id === selectedBranchId) ?? null;
  const canExport = (SEES_ALL_DEPARTMENTS as readonly string[]).includes(user.role);
  // Categories that actually have products, and which counters they sit under,
  // so the download menu only offers choices that give a non-empty record.
  const exportCategories = canExport
    ? await prisma.product
        .groupBy({
          by: ["categoryId", "department"],
          where: { organizationId: org.id, isActive: true, categoryId: { not: null } },
        })
        .then(async (pairs) => {
          const cats = await prisma.category.findMany({
            where: { organizationId: org.id, id: { in: [...new Set(pairs.map((p) => p.categoryId!))] } },
            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
            select: { id: true, name: true },
          });
          return cats.map((c) => ({
            ...c,
            departments: pairs.filter((p) => p.categoryId === c.id).map((p) => p.department),
          }));
        })
    : [];
  const departmentsEnabled = canExport
    ? Boolean(
        (await prisma.orgSettings.findUnique({ where: { organizationId: org.id }, select: { departmentsEnabled: true } }))
          ?.departmentsEnabled,
      )
    : false;
  const multiBranch = branches.length > 1;

  return (
    <>
      <PageHeader
        title="Stock"
        subtitle={
          multiBranch && selectedBranch
            ? `On hand at ${selectedBranch.name}`
            : "What's on hand across your products"
        }
        action={
          canExport && rows.length > 0 ? (
            <ExportStockButton
              departmentsEnabled={departmentsEnabled}
              branches={branches.map((b) => ({ id: b.id, name: b.name }))}
              selectedBranchId={selectedBranchId}
              pinnedBranch={Boolean(pinnedBranch(session))}
              categories={exportCategories}
            />
          ) : undefined
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="Nothing to count yet"
          body="Once you've added products and recorded some stock, their on-hand levels show up here — and you can recount or adjust them any time."
          action={
            <Link href="/products/add" className="btn btn-primary">
              Add a product
            </Link>
          }
        />
      ) : (
        <StockClient
          rows={rows}
          branches={branches.map((b) => ({ id: b.id, name: b.name, code: b.code }))}
          selectedBranchId={selectedBranchId}
          multiBranch={multiBranch}
          initialFilter={initialFilter}
          canAdjust={hasPermission(user, PERMISSIONS.STOCK_ADJUST)}
          timezone={org.timezone}
          truncated={rows.length >= MAX_ROWS}
        />
      )}
    </>
  );
}
