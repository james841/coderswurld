import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ChevronLeft, ChevronRight, Package, Receipt as ReceiptIcon } from "lucide-react";

import { requireTenant } from "@/lib/auth";
import { PAYMENT_METHOD_LABELS, PERMISSIONS, type PaymentMethod } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { dayRange, formatDate, isoDateInZone } from "@/lib/dates";
import { formatNaira } from "@/lib/money";
import { hasPermission } from "@/lib/permissions";

import { NoAccess } from "@/components/ui/NoAccess";
import { PageHeader } from "@/components/ui/PageHeader";

/**
 * One cashier's day: every product they sold, how many, and for how much,
 * then each sale they rang up.
 *
 * Opened from "Today, by cashier" on the dashboard. This is the page an owner
 * uses at closing time to check a cashier's drawer against what the system
 * says they sold.
 *
 * Who can see it: anyone allowed to see every cashier's sales, and a cashier
 * looking at their own day. Nobody else, including a cashier peeking at a
 * colleague by changing the address.
 *
 * Voided sales are left out of every total (they never happened as far as the
 * money is concerned) but are listed at the bottom, marked, so a void is
 * never invisible.
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "Cashier sales" };

function parseDayAnchor(date: string | null): Date {
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const anchor = new Date(`${date}T12:00:00.000Z`);
    if (!Number.isNaN(anchor.getTime())) return anchor;
  }
  return new Date();
}

function addDays(key: string, delta: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

function fmtQty(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}

export default async function CashierSalesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { org, user } = await requireTenant();
  const { id } = await params;
  const query = await searchParams;

  const isSelf = id === user.id;
  const allowed =
    hasPermission(user, PERMISSIONS.SALES_VIEW_ALL) || (isSelf && hasPermission(user, PERMISSIONS.SALES_VIEW));
  if (!allowed) return <NoAccess what="this cashier's sales" />;

  const cashier = await prisma.user.findFirst({
    where: { id, organizationId: org.id },
    select: { id: true, name: true, role: true, isActive: true },
  });
  if (!cashier) notFound();

  const canSeeProfit = hasPermission(user, PERMISSIONS.REPORTS_PROFIT);

  const today = isoDateInZone(new Date(), org.timezone);
  const dateKey = typeof query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(query.date) ? query.date : today;
  const { start, end } = dayRange(parseDayAnchor(dateKey), org.timezone);

  const saleWhere = {
    organizationId: org.id,
    cashierId: cashier.id,
    soldAt: { gte: start, lt: end },
  };

  const [products, sales] = await Promise.all([
    // Products, added up across all of the day's completed sales. Grouped by
    // name and price type, so 10 Indomie at retail and 5 at wholesale show as
    // two lines: that is how the money was actually taken.
    prisma.saleItem.groupBy({
      by: ["productName", "priceType", "unit"],
      where: { organizationId: org.id, sale: { ...saleWhere, status: "COMPLETED" } },
      _sum: { quantity: true, lineTotalKobo: true, lineProfitKobo: true },
      orderBy: { _sum: { lineTotalKobo: "desc" } },
    }),
    prisma.sale.findMany({
      where: saleWhere,
      orderBy: { soldAt: "desc" },
      take: 500,
      select: {
        id: true,
        receiptNo: true,
        soldAt: true,
        status: true,
        totalKobo: true,
        paidKobo: true,
        balanceKobo: true,
        profitKobo: true,
        taxKobo: true,
        discountKobo: true,
        paymentMethod: true,
        _count: { select: { items: true } },
      },
    }),
  ]);

  const done = sales.filter((s) => s.status === "COMPLETED");
  const totalKobo = done.reduce((n, s) => n + s.totalKobo, 0);
  const owingKobo = done.reduce((n, s) => n + s.balanceKobo, 0);
  const profitKobo = done.reduce((n, s) => n + s.profitKobo, 0);
  const productsKobo = products.reduce((n, p) => n + (p._sum.lineTotalKobo ?? 0), 0);
  // Sale totals include VAT (when added on top) and whole-order discounts,
  // which no single product carries. Shown under the table so the figures add up.
  const adjustKobo = totalKobo - productsKobo;
  const vatKobo = done.reduce((n, s) => n + s.taxKobo, 0);
  const itemsSold = products.reduce((n, p) => n + (p._sum.quantity ?? 0), 0);

  // Cash, transfer, POS… so the owner can count the drawer against "Cash".
  const byMethod = new Map<string, number>();
  for (const s of done) byMethod.set(s.paymentMethod, (byMethod.get(s.paymentMethod) ?? 0) + s.paidKobo);

  const time = new Intl.DateTimeFormat("en-NG", { timeZone: org.timezone, hour: "numeric", minute: "2-digit" });
  const dayLabel = dateKey === today ? "Today" : formatDate(start, org.timezone);
  const base = `/sales/cashier/${cashier.id}`;

  return (
    <>
      <Link
        href="/dashboard"
        className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-600 hover:text-ink-950"
      >
        <ArrowLeft className="size-4" />
        Dashboard
      </Link>

      <PageHeader
        title={cashier.name}
        subtitle={`What ${cashier.name.split(" ")[0]} sold · ${dayLabel}${cashier.isActive ? "" : " · deactivated"}`}
      />

      {/* Day picker */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link href={`${base}?date=${addDays(dateKey, -1)}`} className="btn btn-outline btn-sm" aria-label="Previous day">
          <ChevronLeft className="size-4" />
        </Link>
        <form action={base} className="flex items-center gap-2">
          <input type="date" name="date" defaultValue={dateKey} max={today} className="input h-9 w-auto" />
          <button type="submit" className="btn btn-outline btn-sm">
            Show
          </button>
        </form>
        {dateKey < today ? (
          <Link href={`${base}?date=${addDays(dateKey, 1)}`} className="btn btn-outline btn-sm" aria-label="Next day">
            <ChevronRight className="size-4" />
          </Link>
        ) : null}
        {dateKey !== today ? (
          <Link href={base} className="btn btn-ghost btn-sm">
            Today
          </Link>
        ) : null}
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total sold" value={formatNaira(totalKobo)} strong />
        <Stat label="Sales" value={String(done.length)} />
        <Stat label="Items sold" value={fmtQty(itemsSold)} />
        {canSeeProfit ? (
          <Stat label="Profit" value={formatNaira(profitKobo)} />
        ) : (
          <Stat label="Still owed (credit)" value={formatNaira(owingKobo)} />
        )}
      </div>

      {byMethod.size > 0 ? (
        <div className="card card-pad mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <span className="text-xs font-bold uppercase tracking-wider text-ink-500">Money taken</span>
          {[...byMethod.entries()].map(([method, kobo]) => (
            <span key={method} className="text-ink-700">
              {PAYMENT_METHOD_LABELS[method as PaymentMethod] ?? method}:{" "}
              <strong className="tabular text-ink-950">{formatNaira(kobo)}</strong>
            </span>
          ))}
          {owingKobo > 0 && canSeeProfit ? (
            <span className="text-ink-700">
              On credit: <strong className="tabular text-bad-700">{formatNaira(owingKobo)}</strong>
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Products */}
      <section className="card mt-4 overflow-hidden">
        <div className="flex items-center gap-2 border-b border-hairline p-4">
          <Package className="size-4 text-navy-600" />
          <h2 className="text-base font-bold text-ink-950">Products sold</h2>
        </div>
        {products.length === 0 ? (
          <p className="p-6 text-center text-sm text-ink-500">No sales on this day.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Price</th>
                  <th className="text-right">Quantity</th>
                  <th className="text-right">Amount</th>
                  {canSeeProfit ? <th className="text-right">Profit</th> : null}
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={`${p.productName}-${p.priceType}-${p.unit}`}>
                    <td className="font-medium text-ink-900">{p.productName}</td>
                    <td>
                      <span className={`badge ${p.priceType === "WHOLESALE" ? "badge-warn" : "badge-neutral"}`}>
                        {p.priceType === "WHOLESALE" ? "Wholesale" : "Retail"}
                      </span>
                    </td>
                    <td data-numeric className="text-right">
                      {fmtQty(p._sum.quantity ?? 0)} {p.unit}
                    </td>
                    <td data-numeric className="text-right font-semibold text-ink-950">
                      {formatNaira(p._sum.lineTotalKobo ?? 0)}
                    </td>
                    {canSeeProfit ? (
                      <td data-numeric className="text-right text-ink-600">
                        {formatNaira(p._sum.lineProfitKobo ?? 0)}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-canvas [&_td]:px-4 [&_td]:py-2.5">
                <tr className="border-t-2 border-hairline font-bold">
                  <td colSpan={2}>Products total</td>
                  <td data-numeric className="text-right">{fmtQty(itemsSold)}</td>
                  <td data-numeric className="text-right text-ink-950">{formatNaira(productsKobo)}</td>
                  {canSeeProfit ? (
                    <td data-numeric className="text-right">
                      {formatNaira(products.reduce((n, p) => n + (p._sum.lineProfitKobo ?? 0), 0))}
                    </td>
                  ) : null}
                </tr>
                {adjustKobo !== 0 ? (
                  <tr className="text-ink-600">
                    <td colSpan={3}>
                      {adjustKobo > 0 && vatKobo > 0
                        ? "VAT added at the till"
                        : adjustKobo < 0
                          ? "Discounts on whole sales"
                          : "VAT and discounts"}
                    </td>
                    <td data-numeric className="text-right">
                      {adjustKobo > 0 ? "+" : "−"}
                      {formatNaira(Math.abs(adjustKobo))}
                    </td>
                    {canSeeProfit ? <td /> : null}
                  </tr>
                ) : null}
                {adjustKobo !== 0 ? (
                  <tr className="font-bold">
                    <td colSpan={3}>Total sold</td>
                    <td data-numeric className="text-right text-ink-950">{formatNaira(totalKobo)}</td>
                    {canSeeProfit ? <td /> : null}
                  </tr>
                ) : null}
              </tfoot>
            </table>
          </div>
        )}
      </section>

      {/* Each sale */}
      <section className="card mt-4 overflow-hidden">
        <div className="flex items-center gap-2 border-b border-hairline p-4">
          <ReceiptIcon className="size-4 text-navy-600" />
          <h2 className="text-base font-bold text-ink-950">Each sale</h2>
          <span className="text-sm text-ink-500">· click one to see its receipt</span>
        </div>
        {sales.length === 0 ? (
          <p className="p-6 text-center text-sm text-ink-500">No sales on this day.</p>
        ) : (
          <ul className="divide-y divide-hairline">
            {sales.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/sales/${s.id}`}
                  className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors hover:bg-navy-50 ${
                    s.status === "COMPLETED" ? "" : "opacity-60"
                  }`}
                >
                  <span className="w-20 shrink-0 text-sm tabular text-ink-500">{time.format(s.soldAt)}</span>
                  <span className="font-mono text-sm font-semibold text-ink-900">{s.receiptNo}</span>
                  <span className="text-sm text-ink-500">
                    {s._count.items} {s._count.items === 1 ? "product" : "products"} ·{" "}
                    {PAYMENT_METHOD_LABELS[s.paymentMethod as PaymentMethod] ?? s.paymentMethod}
                  </span>
                  {s.status !== "COMPLETED" ? <span className="badge badge-bad">Voided</span> : null}
                  {s.balanceKobo > 0 && s.status === "COMPLETED" ? (
                    <span className="badge badge-warn">Owes {formatNaira(s.balanceKobo)}</span>
                  ) : null}
                  <span className="ml-auto text-base font-bold tabular text-ink-950">{formatNaira(s.totalKobo)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function Stat({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`card card-pad ${strong ? "texture-waves border-navy-700 bg-navy-700 text-white" : ""}`}>
      <p className={`text-xs font-bold uppercase tracking-wider ${strong ? "text-white/70" : "text-ink-500"}`}>{label}</p>
      <p className={`tabular mt-1 text-2xl font-bold ${strong ? "text-white" : "text-ink-950"}`}>{value}</p>
    </div>
  );
}
