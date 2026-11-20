import Link from "next/link";
import { Prisma } from "@prisma/client";
import {
  Banknote,
  Coins,
  Receipt,
  ShoppingBasket,
  TrendingUp,
  Trophy,
  UserRound,
  Wallet,
} from "lucide-react";

import { requireTenant } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { hasPermission } from "@/lib/permissions";
import { PERMISSIONS, PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/constants";
import {
  DEFAULT_LOCALE,
  dayRange,
  formatDate,
  formatDayShort,
  isoDateInZone,
  lastNDaysRange,
  monthRange,
} from "@/lib/dates";
import { formatNaira, fromKobo } from "@/lib/money";

import { PageHeader } from "@/components/ui/PageHeader";
import { NoAccess } from "@/components/ui/NoAccess";
import { StatTile, percentChange } from "@/components/ui/StatTile";
import { ExportButton, type ReportExport } from "./ExportButton";
import { DailyReportCard, type DailyReportStatus } from "./DailyReportCard";

/**
 * Reports — the shop over a stretch of time, not just today.
 *
 * The dashboard answers "how is today going?". This answers "how did the week
 * go, who sold it, and what moved?" — the questions an owner asks on a quiet
 * afternoon, not between customers. One range picker drives everything; the
 * server resolves it, gathers every figure in a single round trip and hands the
 * page down finished.
 *
 * WHAT THE READER IS ALLOWED TO SEE
 * ---------------------------------
 * Same grants as the dashboard. Profit and margin sit behind `reports.profit`;
 * the by-cashier breakdown behind `sales.view_all`; the CSV behind
 * `reports.export`. A manager trusted to watch the floor is not automatically
 * trusted with the margin, and tiles they can't hold simply aren't rendered.
 *
 * The one thing this page does that the dashboard doesn't is close the loop on
 * the brief's stated requirement — the end-of-day sales report by cashier,
 * emailed or sent on WhatsApp — with its live status and a Send-now button.
 */

export const dynamic = "force-dynamic";
export const metadata = { title: "Reports" };

const RANGES = [
  { key: "today", label: "Today" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "month", label: "This month" },
] as const;

type RangeKey = (typeof RANGES)[number]["key"];

/** One calendar day of trading, keyed by "YYYY-MM-DD" from Postgres. */
interface DaySalesRow {
  day: string;
  revenue: string | bigint | null;
  sales: number;
}

const DAY_MS = 86_400_000;

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireTenant();
  const { org, user, branch } = session;

  if (!hasPermission(user, PERMISSIONS.REPORTS_VIEW)) {
    return <NoAccess what="the reports" />;
  }

  const canSeeProfit = hasPermission(user, PERMISSIONS.REPORTS_PROFIT);
  const canSeeStaff = hasPermission(user, PERMISSIONS.SALES_VIEW_ALL);
  const canExport = hasPermission(user, PERMISSIONS.REPORTS_EXPORT);
  const canSeeExpenses = hasPermission(user, PERMISSIONS.EXPENSES_VIEW);

  const params = await searchParams;
  const rawRange = typeof params.range === "string" ? params.range : "";
  const rangeKey: RangeKey = RANGES.some((r) => r.key === rawRange)
    ? (rawRange as RangeKey)
    : "7d";
  const rangeLabel = RANGES.find((r) => r.key === rangeKey)!.label;

  const now = new Date();
  const tz = org.timezone;
  const today = dayRange(now, tz);
  const todayKey = isoDateInZone(now, tz);

  // Resolve the window. 7d/30d already end at today's close; month runs to the
  // first of next month, which only matters to the totals — the chart is clipped
  // to today below so it never draws a run of empty future days.
  const { start, end } =
    rangeKey === "today"
      ? today
      : rangeKey === "7d"
        ? lastNDaysRange(7, tz, now)
        : rangeKey === "30d"
          ? lastNDaysRange(30, tz, now)
          : monthRange(now, tz);

  // Previous window of equal length, for the "vs" arrows.
  const span = end.getTime() - start.getTime();
  const prevStart = new Date(start.getTime() - span);

  // A main admin with no branch sees the whole business; a branch-tied user sees
  // only theirs. Decided once, threaded through every figure.
  const branchId = branch?.id ?? null;
  const branchScope = branchId ? { branchId } : {};
  const branchSaleSql = branchId ? Prisma.sql`AND s."branchId" = ${branchId}` : Prisma.empty;

  const completed = {
    organizationId: org.id,
    status: "COMPLETED",
    ...branchScope,
    soldAt: { gte: start, lt: end },
  };
  const completedPrev = {
    organizationId: org.id,
    status: "COMPLETED",
    ...branchScope,
    soldAt: { gte: prevStart, lt: start },
  };

  // The chart stops at the end of today — no empty future bars in a mid-month view.
  const chartEnd = end.getTime() < today.end.getTime() ? end : today.end;

  const [
    totals,
    prevTotals,
    itemsAgg,
    byMethodRaw,
    byCashierRaw,
    staff,
    topRaw,
    daySeries,
    expensesAgg,
    voidedCount,
    settings,
    contact,
    reportLogs,
  ] = await Promise.all([
    prisma.sale.aggregate({
      where: completed,
      _sum: { totalKobo: true, profitKobo: true, balanceKobo: true, discountKobo: true },
      _count: { _all: true },
    }),

    prisma.sale.aggregate({
      where: completedPrev,
      _sum: { totalKobo: true, profitKobo: true },
      _count: { _all: true },
    }),

    prisma.saleItem.aggregate({
      where: { organizationId: org.id, sale: completed },
      _sum: { quantity: true },
    }),

    prisma.sale.groupBy({
      by: ["paymentMethod"],
      where: completed,
      _sum: { totalKobo: true },
      _count: { _all: true },
    }),

    // Queried unconditionally; rendered only behind sales.view_all.
    prisma.sale.groupBy({
      by: ["cashierId"],
      where: completed,
      _sum: { totalKobo: true, profitKobo: true },
      _count: { _all: true },
      orderBy: { _sum: { totalKobo: "desc" } },
    }),

    prisma.user.findMany({
      where: { organizationId: org.id },
      select: { id: true, name: true },
    }),

    prisma.saleItem.groupBy({
      by: ["productName"],
      where: { organizationId: org.id, sale: completed },
      _sum: { quantity: true, lineTotalKobo: true },
      orderBy: { _sum: { lineTotalKobo: "desc" } },
      take: 8,
    }),

    prisma.$queryRaw<DaySalesRow[]>`
      SELECT
        to_char(s."soldAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day,
        SUM(s."totalKobo")::bigint AS revenue,
        COUNT(*)::int AS sales
      FROM "Sale" s
      WHERE s."organizationId" = ${org.id}
        AND s.status = 'COMPLETED'
        AND s."soldAt" >= ${start}
        AND s."soldAt" < ${chartEnd}
        ${branchSaleSql}
      GROUP BY 1
      ORDER BY 1
    `,

    prisma.expense.aggregate({
      where: { organizationId: org.id, ...branchScope, expenseDate: { gte: start, lt: end } },
      _sum: { amountKobo: true },
    }),

    prisma.sale.count({
      where: { organizationId: org.id, ...branchScope, status: "VOIDED", soldAt: { gte: start, lt: end } },
    }),

    prisma.orgSettings.findUnique({
      where: { organizationId: org.id },
      select: {
        dailyReportEnabled: true,
        reportChannel: true,
        reportEmail: true,
        reportWhatsapp: true,
        reportTime: true,
      },
    }),

    prisma.organization.findUnique({
      where: { id: org.id },
      select: { email: true, whatsapp: true },
    }),

    // Today's delivery attempts, for the live status on the report card.
    prisma.reportLog.findMany({
      where: { organizationId: org.id, period: "DAILY", periodKey: todayKey },
      select: { channel: true, status: true, recipient: true, sentAt: true, errorMessage: true },
    }),
  ]);

  const revenue = totals._sum.totalKobo ?? 0;
  const prevRevenue = prevTotals._sum.totalKobo ?? 0;
  const salesCount = totals._count._all;
  const prevSalesCount = prevTotals._count._all;
  const profit = totals._sum.profitKobo ?? 0;
  const prevProfit = prevTotals._sum.profitKobo ?? 0;
  const credit = totals._sum.balanceKobo ?? 0;
  const discount = totals._sum.discountKobo ?? 0;
  const items = itemsAgg._sum.quantity ?? 0;
  const expenses = expensesAgg._sum.amountKobo ?? 0;
  const net = profit - expenses;
  const avgSale = salesCount > 0 ? Math.round(revenue / salesCount) : 0;

  const nameById = new Map(staff.map((m) => [m.id, m.name]));

  const byCashier = byCashierRaw.map((row) => ({
    name: nameById.get(row.cashierId) ?? "Removed account",
    sales: row._count._all,
    takenKobo: row._sum.totalKobo ?? 0,
    profitKobo: row._sum.profitKobo ?? 0,
  }));

  const byMethod = byMethodRaw
    .map((row) => ({
      method: row.paymentMethod,
      label: PAYMENT_METHOD_LABELS[row.paymentMethod as PaymentMethod] ?? row.paymentMethod,
      amountKobo: row._sum.totalKobo ?? 0,
      count: row._count._all,
    }))
    .sort((a, b) => b.amountKobo - a.amountKobo);

  const topProducts = topRaw.map((row) => ({
    name: row.productName,
    qty: row._sum.quantity ?? 0,
    amountKobo: row._sum.lineTotalKobo ?? 0,
  }));

  // Build the full run of days so a quiet day shows as a gap, not a shorter chart.
  const dayCount = Math.max(1, Math.round((chartEnd.getTime() - start.getTime()) / DAY_MS));
  const byDay = new Map(
    daySeries.map((r) => [r.day, { revenue: Number(r.revenue ?? 0), sales: r.sales }]),
  );
  const chart = Array.from({ length: dayCount }, (_, i) => {
    const date = new Date(start.getTime() + i * DAY_MS);
    const key = isoDateInZone(date, tz);
    const row = byDay.get(key);
    return {
      key,
      date,
      revenue: row?.revenue ?? 0,
      sales: row?.sales ?? 0,
      isToday: key === todayKey,
    };
  });
  const peak = Math.max(...chart.map((d) => d.revenue), 1);
  const showChart = dayCount > 1;

  // ── Serialize for the client bits ──────────────────────────────────────────
  const reportStatus: DailyReportStatus = {
    channel: settings?.reportChannel ?? "EMAIL",
    enabled: settings?.dailyReportEnabled ?? true,
    reportTime: settings?.reportTime ?? "21:00",
    hasEmail: Boolean(settings?.reportEmail || contact?.email),
    hasWhatsapp: Boolean(settings?.reportWhatsapp || contact?.whatsapp),
    todayLabel: formatDate(now, tz),
    logs: reportLogs.map((l) => ({
      channel: l.channel as "EMAIL" | "WHATSAPP",
      status: l.status as "SENT" | "FAILED" | "PENDING",
      recipient: l.recipient,
      sentAt: l.sentAt ? l.sentAt.toISOString() : null,
      errorMessage: l.errorMessage,
    })),
  };

  const exportData: ReportExport = {
    orgName: org.name,
    rangeKey,
    rangeLabel,
    generatedKey: todayKey,
    includeProfit: canSeeProfit,
    summary: [
      ["Takings", fromKobo(revenue)],
      ["Sales", salesCount],
      ["Items sold", items],
      ["On credit (unpaid)", fromKobo(credit)],
      ["Discounts given", fromKobo(discount)],
      ...(canSeeProfit ? ([["Profit", fromKobo(profit)]] as [string, number][]) : []),
      ...(canSeeExpenses ? ([["Expenses", fromKobo(expenses)]] as [string, number][]) : []),
      ...(canSeeProfit && canSeeExpenses
        ? ([["Net (profit less expenses)", fromKobo(net)]] as [string, number][])
        : []),
      ["Voided sales", voidedCount],
    ],
    byDay: chart.map((d) => ({ day: d.key, revenue: fromKobo(d.revenue), sales: d.sales })),
    byCashier: canSeeStaff
      ? byCashier.map((c) => ({
          name: c.name,
          sales: c.sales,
          taken: fromKobo(c.takenKobo),
          profit: canSeeProfit ? fromKobo(c.profitKobo) : null,
        }))
      : [],
    topProducts: topProducts.map((p) => ({ name: p.name, qty: p.qty, amount: fromKobo(p.amountKobo) })),
    byMethod: byMethod.map((m) => ({ method: m.label, amount: fromKobo(m.amountKobo), count: m.count })),
  };

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle={branch ? `${rangeLabel} at ${branch.name}` : rangeLabel}
        action={canExport ? <ExportButton data={exportData} /> : undefined}
      />

      {/* ── Range picker ────────────────────────────────────────────────────── */}
      <nav className="mb-4 flex flex-wrap gap-2" aria-label="Report period">
        {RANGES.map((r) => {
          const active = r.key === rangeKey;
          return (
            <Link
              key={r.key}
              href={`/reports?range=${r.key}`}
              className={`chip ${active ? "chip-active-all" : ""}`}
              aria-current={active ? "page" : undefined}
            >
              {r.label}
            </Link>
          );
        })}
      </nav>

      {/* ── Hero: the headline figure, and the shape of the period ──────────── */}
      <section className="card card-pad mb-4">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink-500">Takings, {rangeLabel.toLowerCase()}</p>
            <p className="tabular mt-1 text-3xl font-bold tracking-tight text-brand-700 sm:text-4xl">
              {formatNaira(revenue)}
            </p>
            <div className="mt-1.5">
              <HeroDelta value={percentChange(revenue, prevRevenue)} />
            </div>
          </div>
          <div className="tabular text-sm text-ink-500">
            <span className="font-semibold text-ink-800">{salesCount.toLocaleString("en-NG")}</span>{" "}
            {salesCount === 1 ? "sale" : "sales"}
            <span className="mx-2 text-ink-300">/</span>
            <span className="font-semibold text-ink-800">
              {items.toLocaleString("en-NG", { maximumFractionDigits: 2 })}
            </span>{" "}
            items
          </div>
        </div>

        {showChart ? (
          revenue === 0 ? (
            <p className="mt-6 py-8 text-center text-sm text-ink-400">
              No sales recorded in this period yet.
            </p>
          ) : (
            <div className="mt-6">
              <div
                className="flex h-44 items-stretch gap-1"
                role="img"
                aria-label={`Daily takings, ${rangeLabel.toLowerCase()}`}
              >
                {chart.map((day) => {
                  const height = Math.max(
                    (day.revenue / peak) * 100,
                    day.revenue > 0 ? 3 : 1.5,
                  );
                  return (
                    <div key={day.key} className="group relative flex flex-1 flex-col justify-end">
                      <div
                        className={`w-full rounded-t-sm ${
                          day.isToday
                            ? "bg-brand-700"
                            : day.revenue > 0
                              ? "bg-brand-300 group-hover:bg-brand-500"
                              : "bg-ink-100"
                        }`}
                        style={{ height: `${height}%` }}
                      />
                      <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-ink-950 px-2 py-1 text-xs font-semibold text-white group-hover:block">
                        {formatNaira(day.revenue)}
                        <span className="ml-1.5 font-normal text-ink-300">
                          {formatDayShort(day.date, tz)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 flex justify-between text-xs text-ink-400">
                <span>{formatDayShort(chart[0]!.date, tz)}</span>
                <span>{formatDayShort(chart[chart.length - 1]!.date, tz)}</span>
              </div>
            </div>
          )
        ) : null}
      </section>

      {/* ── The figures behind the headline ─────────────────────────────────── */}
      <section className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          icon={Receipt}
          label="Sales"
          value={salesCount.toLocaleString("en-NG")}
          delta={percentChange(salesCount, prevSalesCount)}
          note="vs previous period"
        />
        <StatTile
          icon={Coins}
          label="Average sale"
          value={avgSale > 0 ? formatNaira(avgSale) : "—"}
          note={avgSale > 0 ? "per transaction" : "no sales yet"}
        />
        {canSeeProfit ? (
          <StatTile
            icon={TrendingUp}
            label="Profit"
            value={formatNaira(profit)}
            delta={percentChange(profit, prevProfit)}
            note={revenue > 0 ? `${Math.round((profit / revenue) * 100)}% margin` : "vs previous period"}
            tone={profit < 0 ? "bad" : "plain"}
          />
        ) : (
          <StatTile
            icon={ShoppingBasket}
            label="Items sold"
            value={items.toLocaleString("en-NG", { maximumFractionDigits: 2 })}
            note={salesCount > 0 ? `${(items / salesCount).toFixed(1)} per sale` : "no sales yet"}
          />
        )}
        {canSeeProfit && canSeeExpenses ? (
          <StatTile
            icon={Wallet}
            label="Net"
            value={formatNaira(net)}
            note="profit less expenses"
            tone={net < 0 ? "bad" : "good"}
          />
        ) : credit > 0 ? (
          <StatTile
            icon={UserRound}
            label="On credit"
            value={formatNaira(credit)}
            note="went out unpaid"
            tone="warn"
          />
        ) : (
          <StatTile
            icon={Banknote}
            label="Takings"
            value={formatNaira(revenue)}
            delta={percentChange(revenue, prevRevenue)}
            note="vs previous period"
            accent
          />
        )}
      </section>

      {/* ── Who sold it ─────────────────────────────────────────────────────── */}
      {canSeeStaff ? (
        <section className="mb-4">
          <h2 className="section-title mb-2">By cashier</h2>
          <div className="card overflow-hidden">
            {byCashier.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-ink-400">
                No sales rung up in this period.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Cashier</th>
                      <th data-numeric className="text-right">Sales</th>
                      <th data-numeric className="text-right">Taken</th>
                      <th data-numeric className="text-right">Average</th>
                      {canSeeProfit ? <th data-numeric className="text-right">Profit</th> : null}
                      <th className="w-28">Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byCashier.map((row) => {
                      const share = revenue > 0 ? (row.takenKobo / revenue) * 100 : 0;
                      return (
                        <tr key={row.name}>
                          <td>
                            <span className="flex items-center gap-2">
                              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-ink-100 text-[0.6875rem] font-bold text-ink-600">
                                {initials(row.name)}
                              </span>
                              <span className="truncate font-medium text-ink-900">{row.name}</span>
                            </span>
                          </td>
                          <td data-numeric className="text-right">{row.sales}</td>
                          <td data-numeric className="text-right font-semibold text-ink-950">
                            {formatNaira(row.takenKobo)}
                          </td>
                          <td data-numeric className="text-right text-ink-600">
                            {row.sales > 0 ? formatNaira(Math.round(row.takenKobo / row.sales)) : "—"}
                          </td>
                          {canSeeProfit ? (
                            <td data-numeric className="text-right text-ink-600">
                              {formatNaira(row.profitKobo)}
                            </td>
                          ) : null}
                          <td>
                            <span className="flex items-center gap-2">
                              <span className="h-1.5 w-12 overflow-hidden rounded-full bg-ink-100">
                                <span
                                  className="block h-full rounded-full bg-brand-500"
                                  style={{ width: `${Math.max(share, 2)}%` }}
                                />
                              </span>
                              <span className="tabular text-xs text-ink-500">
                                {Math.round(share)}%
                              </span>
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      ) : null}

      {/* ── Best sellers + payment mix ──────────────────────────────────────── */}
      <section className="mb-4 grid gap-3 lg:grid-cols-2">
        <div className="card overflow-hidden">
          <div className="border-b border-hairline px-4 py-3">
            <h2 className="text-sm font-bold text-ink-900">Best sellers</h2>
          </div>
          {topProducts.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-ink-400">Nothing sold in this period.</p>
          ) : (
            <ul className="divide-y divide-ink-50">
              {topProducts.map((row, index) => (
                <li key={row.name} className="flex items-center gap-3 px-4 py-2.5">
                  <span
                    className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold ${
                      index === 0 ? "bg-brand-50 text-brand-700" : "bg-ink-50 text-ink-500"
                    }`}
                  >
                    {index === 0 ? <Trophy className="size-3.5" /> : index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink-900">{row.name}</span>
                    <span className="tabular mt-0.5 block text-xs text-ink-500">
                      {row.qty.toLocaleString("en-NG", { maximumFractionDigits: 2 })} sold
                    </span>
                  </span>
                  <span className="tabular shrink-0 text-sm font-semibold text-ink-950">
                    {formatNaira(row.amountKobo)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card card-pad">
          <h2 className="mb-3 text-sm font-bold text-ink-900">How it was paid</h2>
          {byMethod.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-400">Nothing taken in this period.</p>
          ) : (
            <ul className="space-y-2.5">
              {byMethod.map((row) => {
                const share = revenue > 0 ? (row.amountKobo / revenue) * 100 : 0;
                return (
                  <li key={row.method}>
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="truncate font-medium text-ink-800">{row.label}</span>
                      <span className="tabular shrink-0 font-semibold text-ink-950">
                        {formatNaira(row.amountKobo)}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-100">
                        <div
                          className="h-full rounded-full bg-brand-500"
                          style={{ width: `${Math.max(share, 1)}%` }}
                        />
                      </div>
                      <span className="tabular w-16 shrink-0 text-right text-xs text-ink-500">
                        {row.count} {row.count === 1 ? "sale" : "sales"}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {discount > 0 ? (
            <p className="mt-3 border-t border-hairline pt-3 text-xs text-ink-500">
              <span className="font-semibold text-ink-700">{formatNaira(discount)}</span> given away in
              discounts over this period.
            </p>
          ) : null}
        </div>
      </section>

      {/* ── The end-of-day report ───────────────────────────────────────────── */}
      <DailyReportCard status={reportStatus} />
    </>
  );
}

/** The hero's own delta line — larger than the tile chips, same meaning. */
function HeroDelta({ value }: { value: number | null }) {
  if (value === null) {
    return <span className="text-sm text-ink-400">nothing to compare against yet</span>;
  }
  const rounded = Math.round(value);
  if (rounded === 0) {
    return <span className="text-sm font-medium text-ink-500">level with the period before</span>;
  }
  const up = rounded > 0;
  return (
    <span className={`text-sm font-semibold ${up ? "text-good-700" : "text-bad-700"}`}>
      {up ? "Up" : "Down"} {Math.abs(rounded)}% on the period before
    </span>
  );
}

/** "Chidi Okonkwo" → "CO". */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}
