import Link from "next/link";
import { CheckCircle2 } from "lucide-react";

import { requireTenant } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { formatNaira } from "@/lib/money";
import { hasPermission } from "@/lib/permissions";
import { pinnedBranch } from "@/lib/branchScope";
import { buildReorderList, LOOKBACK_DAYS, type ReorderRow } from "@/lib/reorder";
import { NoAccess } from "@/components/ui/NoAccess";
import { PageHeader } from "@/components/ui/PageHeader";

import { SupplierOrderActions } from "./SupplierOrderActions";

export const dynamic = "force-dynamic";
export const metadata = { title: "What to reorder" };

const COVERS = [14, 30, 60] as const;
const LEAD_DAYS = 3;

export default async function ReorderPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireTenant();
  const { org, user } = session;
  const branch = pinnedBranch(session);
  if (!hasPermission(user, PERMISSIONS.PURCHASES_VIEW)) return <NoAccess what="reorder suggestions" />;
  const canReceive = hasPermission(user, PERMISSIONS.PURCHASES_MANAGE);

  const sp = await searchParams;
  const cover = COVERS.find((c) => String(c) === sp.cover) ?? 30;

  const [branches, settings] = await Promise.all([
    prisma.branch.findMany({
      where: { organizationId: org.id, isActive: true },
      orderBy: [{ isMain: "desc" }, { name: "asc" }],
      select: { id: true, name: true, isMain: true },
    }),
    prisma.orgSettings.findUnique({ where: { organizationId: org.id }, select: { defaultLowStock: true } }),
  ]);
  const requested = typeof sp.branch === "string" ? sp.branch : undefined;
  const branchId =
    branch?.id ??
    (requested && branches.some((b) => b.id === requested) ? requested : undefined) ??
    branches.find((b) => b.isMain)?.id ??
    branches[0]?.id ??
    "";

  const rows = branchId
    ? await buildReorderList({
        organizationId: org.id,
        branchId,
        department: user.department,
        coverDays: cover,
        leadDays: LEAD_DAYS,
        defaultLowStock: settings?.defaultLowStock ?? 5,
      })
    : [];

  // One card per supplier, since that is how the ordering actually happens.
  const groups = new Map<string, { name: string; phone: string | null; supplierId: string | null; rows: ReorderRow[] }>();
  for (const r of rows) {
    const key = r.supplierId ?? "none";
    if (!groups.has(key)) groups.set(key, { name: r.supplierName ?? "No usual supplier set", phone: r.supplierPhone, supplierId: r.supplierId, rows: [] });
    groups.get(key)!.rows.push(r);
  }
  const ordered = [...groups.values()].sort((a, b) => (a.supplierId ? 0 : 1) - (b.supplierId ? 0 : 1));
  const total = rows.reduce((t, r) => t + r.suggestQty * r.costPriceKobo, 0);
  const outCount = rows.filter((r) => r.onHand <= 0).length;
  const qs = (patch: Record<string, string>) =>
    "?" + new URLSearchParams({ cover: String(cover), ...(branch ? {} : { branch: branchId }), ...patch }).toString();

  return (
    <div className="space-y-5">
      <PageHeader
        title="What to reorder"
        subtitle={`Worked out from the last ${LOOKBACK_DAYS} days of sales. Enough to last ${cover} days, plus ${LEAD_DAYS} days for delivery.`}
      />

      <div className="flex flex-wrap items-center gap-3">
        <nav className="flex rounded-full bg-white p-1 shadow-sm ring-1 ring-hairline" aria-label="How long the order should last">
          {COVERS.map((c) => (
            <Link
              key={c}
              href={qs({ cover: String(c) })}
              className={`rounded-full px-3 py-1.5 text-sm font-semibold ${c === cover ? "bg-navy-700 text-white" : "text-ink-600 hover:text-ink-950"}`}
            >
              {c} days of stock
            </Link>
          ))}
        </nav>
        {!branch && branches.length > 1 ? (
          <nav className="flex flex-wrap gap-1">
            {branches.map((b) => (
              <Link
                key={b.id}
                href={qs({ branch: b.id })}
                className={`rounded-full px-3 py-1.5 text-sm font-semibold ring-1 ${
                  b.id === branchId ? "bg-navy-50 text-navy-800 ring-navy-200" : "text-ink-600 ring-hairline hover:text-ink-950"
                }`}
              >
                {b.name}
              </Link>
            ))}
          </nav>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <div className="card card-pad flex flex-col items-center gap-2 py-12 text-center">
          <CheckCircle2 className="size-8 text-good-700" />
          <p className="font-semibold text-ink-900">Nothing needs reordering</p>
          <p className="max-w-md text-sm text-ink-500">
            Every product has enough stock for the next {cover} days at the speed it has been selling.
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Products to reorder" value={String(rows.length)} />
            <Stat label="Already out of stock" value={String(outCount)} tone={outCount ? "text-sell-700" : undefined} />
            <Stat label="Estimated cost" value={formatNaira(total)} />
          </div>

          {ordered.map((g) => {
            const cost = g.rows.reduce((t, r) => t + r.suggestQty * r.costPriceKobo, 0);
            const items = g.rows.map((r) => `${r.productId}:${r.suggestQty}`).join(",");
            return (
              <section key={g.supplierId ?? "none"} className="card overflow-hidden rounded-2xl">
                <header className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-4 py-3">
                  <div>
                    <h2 className="font-bold text-ink-950">{g.name}</h2>
                    <p className="text-xs text-ink-500">
                      {g.rows.length} {g.rows.length === 1 ? "item" : "items"}, about {formatNaira(cost)}
                    </p>
                  </div>
                  <SupplierOrderActions
                    shopName={org.name}
                    supplierName={g.supplierId ? g.name : null}
                    supplierPhone={g.phone}
                    lines={g.rows.map((r) => ({ name: r.name, qty: r.suggestQty, unit: r.unit }))}
                    receiveHref={
                      canReceive
                        ? `/purchases/new?${new URLSearchParams({ ...(g.supplierId ? { supplier: g.supplierId } : {}), branch: branchId, items }).toString()}`
                        : null
                    }
                  />
                </header>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead className="bg-canvas text-left text-xs uppercase tracking-wide text-ink-500">
                      <tr>
                        <th className="px-4 py-2 font-semibold">Product</th>
                        <th className="px-4 py-2 text-right font-semibold">On hand</th>
                        <th className="px-4 py-2 text-right font-semibold">Sold ({LOOKBACK_DAYS} days)</th>
                        <th className="px-4 py-2 text-right font-semibold">Runs out</th>
                        <th className="px-4 py-2 text-right font-semibold">Order</th>
                        <th className="px-4 py-2 text-right font-semibold">Cost</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-hairline">
                      {g.rows.map((r) => (
                        <tr key={r.productId}>
                          <td className="px-4 py-2.5">
                            <p className="font-semibold text-ink-900">{r.name}</p>
                            <p className="font-mono text-xs text-ink-500">{r.sku}</p>
                          </td>
                          <td className="tabular px-4 py-2.5 text-right">{r.onHand}</td>
                          <td className="tabular px-4 py-2.5 text-right text-ink-600">{r.soldInPeriod}</td>
                          <td className="px-4 py-2.5 text-right">
                            <RunsOut row={r} />
                          </td>
                          <td className="tabular px-4 py-2.5 text-right font-bold text-ink-950">
                            {r.suggestQty} <span className="font-normal text-ink-500">{r.unit}</span>
                          </td>
                          <td className="tabular px-4 py-2.5 text-right text-ink-600">
                            {r.costPriceKobo ? formatNaira(r.suggestQty * r.costPriceKobo) : "No cost set"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
          <p className="text-xs text-ink-500">
            These are suggestions. Change the quantities on the purchase before you save it. Products with no usual
            supplier can be given one on the product page.
          </p>
        </>
      )}
    </div>
  );
}

function RunsOut({ row }: { row: ReorderRow }) {
  if (row.onHand <= 0) return <span className="badge badge-bad">Out now</span>;
  if (row.daysLeft === null) return <span className="badge badge-neutral">Below reorder level</span>;
  const d = Math.floor(row.daysLeft);
  return (
    <span className={`badge ${d <= 7 ? "badge-bad" : d <= 14 ? "badge-warn" : "badge-neutral"}`}>
      {d === 0 ? "Today" : `in ${d} day${d === 1 ? "" : "s"}`}
    </span>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="card card-pad rounded-2xl">
      <p className="text-xs font-bold uppercase tracking-wider text-ink-500">{label}</p>
      <p className={`tabular mt-1 text-2xl font-bold ${tone ?? "text-ink-950"}`}>{value}</p>
    </div>
  );
}
