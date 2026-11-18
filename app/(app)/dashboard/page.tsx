import Link from "next/link";
import { Prisma } from "@prisma/client";
import {
  AlertTriangle,
  Banknote,
  CalendarClock,
  Coins,
  Package,
  PackageX,
  Receipt,
  ReceiptText,
  ShoppingBasket,
  Store,
  TrendingUp,
  Trophy,
  UserRound,
  Wallet,
} from "lucide-react";

import { EmptyState } from "@/components/ui/EmptyState";
import { NoAccess } from "@/components/ui/NoAccess";
import { PageHeader } from "@/components/ui/PageHeader";
import { QuickActions } from "@/components/dashboard/QuickActions";
import { RevealSection } from "@/components/motion";
import { StatTile, percentChange } from "@/components/ui/StatTile";
import { requireTenant } from "@/lib/auth";
import {
  DEFAULT_EXPIRY_WARNING_DAYS,
  PAYMENT_METHOD_LABELS,
  PERMISSIONS,
  type PaymentMethod,
} from "@/lib/constants";
import {
  dayRange,
  daysBetween,
  formatDate,
  formatDayShort,
  formatTime,
  isoDateInZone,
  lastNDaysRange,
} from "@/lib/dates";
import { prisma } from "@/lib/db";
import { formatNaira, formatNairaCompact } from "@/lib/money";
import { hasPermission } from "@/lib/permissions";

/**
 * The screen a shop owner opens first, usually on a phone, usually to answer one
 * question: how did today go, and is anything about to go wrong?
 *
 * WHY EVERYTHING IS ONE ROUND TRIP
 * --------------------------------
 * Every figure below is gathered in a single `Promise.all`. Sixteen awaited
 * statements in sequence would each pay the round trip to Postgres — tolerable
 * on a laptop next to the server, miserable over a Nigerian mobile connection
 * to a pooler. One batch, one wait.
 *
 * Nothing on this page is fetched from the browser. The whole thing renders on
 * the server and arrives as HTML, so the first paint has real numbers in it
 * rather than a grid of skeletons that resolve a second later.
 *
 * WHY TWO QUERIES ARE RAW SQL
 * ---------------------------
 * Low stock means `StockLevel.quantity <= Product.minStock` — a comparison
 * between two columns in different tables, which Prisma's `where` cannot
 * express. The alternative is reading every product and its stock row into
 * memory to compare in JavaScript: thousands of rows on every dashboard load,
 * to produce one integer. The daily revenue series is raw for the same kind of
 * reason — grouping by calendar day in the shop's timezone is a database job.
 *
 * WHAT THE READER IS ALLOWED TO SEE
 * ---------------------------------
 * Profit, cost and debt are each behind their own permission. A sub-admin
 * trusted to watch the till is not automatically trusted with the margin, and
 * the difference between those two is the whole point of granular grants. Tiles
 * the user can't hold simply aren't rendered — no greyed-out teasers.
 */

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Dashboard",
};

/** Rows pg hands back for the stock-health query. Cast to ::int in SQL. */
interface StockHealthRow {
  low: number;
  out: number;
}

/** One calendar day of trading, keyed by a "YYYY-MM-DD" string from Postgres. */
interface DaySalesRow {
  day: string;
  revenue: string | bigint | null;
  sales: number;
}

const SERIES_DAYS = 14;

export default async function DashboardPage() {
  const session = await requireTenant();
  const { org, user, branch } = session;

  if (!hasPermission(user, PERMISSIONS.DASHBOARD_VIEW)) {
    return (
      <NoAccess
        what="the dashboard"
        homeHref={hasPermission(user, PERMISSIONS.POS_SELL) ? "/pos" : null}
      />
    );
  }

  const canSeeProfit = hasPermission(user, PERMISSIONS.REPORTS_PROFIT);
  const canSeeStock = hasPermission(user, PERMISSIONS.STOCK_VIEW);
  const canSeeProducts = hasPermission(user, PERMISSIONS.PRODUCTS_VIEW);
  const canSeeSales = hasPermission(user, PERMISSIONS.SALES_VIEW);
  const canSeeDebt = hasPermission(user, PERMISSIONS.CUSTOMERS_DEBT);
  const canSeeExpenses = hasPermission(user, PERMISSIONS.EXPENSES_VIEW);
  const canSeeStaffFigures = hasPermission(user, PERMISSIONS.SALES_VIEW_ALL);

  const now = new Date();
  const tz = org.timezone;
  const today = dayRange(now, tz);
  // One millisecond before midnight is yesterday, in whatever zone the shop
  // keeps. Subtracting 24 hours would be wrong on a DST boundary.
  const yesterday = dayRange(new Date(today.start.getTime() - 1), tz);
  const series = lastNDaysRange(SERIES_DAYS, tz, now);

  /*
   * A main admin with no branch assigned sees the whole business; a user tied to
   * a branch sees only theirs. That single value decides the scope of every
   * figure on the page, which is why it's computed once here and threaded
   * through rather than re-derived per query.
   */
  const branchId = branch?.id ?? null;
  const branchScope = branchId ? { branchId } : {};
  const branchSql = branchId ? Prisma.sql`AND sl."branchId" = ${branchId}` : Prisma.empty;
  const branchSaleSql = branchId ? Prisma.sql`AND s."branchId" = ${branchId}` : Prisma.empty;

  // `soldAt`, never `createdAt`. A sale rung up offline and synced an hour later
  // belongs to the moment the customer paid, not the moment the row arrived.
  const completedSales = {
    organizationId: org.id,
    status: "COMPLETED",
    ...branchScope,
  };

  // Read first, batch second: the expiry window is a setting, and the query that
  // uses it needs the number before it can be written. One tiny indexed lookup.
  const settings = await prisma.orgSettings.findUnique({
    where: { organizationId: org.id },
    select: { expiryWarningDays: true },
  });
  const expiryWindowDays = settings?.expiryWarningDays ?? DEFAULT_EXPIRY_WARNING_DAYS;
  const expiryCutoff = new Date(today.start.getTime() + expiryWindowDays * 86_400_000);

  const [
    todayTotals,
    yesterdayTotals,
    todayItems,
    byMethod,
    byCashier,
    staff,
    stockHealth,
    expiringSoon,
    expiredCount,
    recentSales,
    topProducts,
    daySeries,
    debt,
    todayExpenses,
    subscription,
    productCount,
  ] = await Promise.all([
    prisma.sale.aggregate({
      where: { ...completedSales, soldAt: { gte: today.start, lt: today.end } },
      _sum: { totalKobo: true, profitKobo: true, balanceKobo: true },
      _count: { _all: true },
    }),

    prisma.sale.aggregate({
      where: { ...completedSales, soldAt: { gte: yesterday.start, lt: yesterday.end } },
      _sum: { totalKobo: true, profitKobo: true },
      _count: { _all: true },
    }),

    prisma.saleItem.aggregate({
      where: {
        organizationId: org.id,
        sale: { ...completedSales, soldAt: { gte: today.start, lt: today.end } },
      },
      _sum: { quantity: true },
    }),

    prisma.sale.groupBy({
      by: ["paymentMethod"],
      where: { ...completedSales, soldAt: { gte: today.start, lt: today.end } },
      _sum: { totalKobo: true },
      _count: { _all: true },
    }),

    /*
     * "Every detail of today's sales by the cashier" — the requirement this
     * table exists for. Backed by the [organizationId, cashierId, soldAt] index,
     * so it stays an index scan over one day rather than a table sweep.
     */
    prisma.sale.groupBy({
      by: ["cashierId"],
      where: { ...completedSales, soldAt: { gte: today.start, lt: today.end } },
      _sum: { totalKobo: true, profitKobo: true },
      _count: { _all: true },
      orderBy: { _sum: { totalKobo: "desc" } },
    }),

    // Fetched in the same batch and joined in memory. A staff list is tens of
    // rows; a correlated lookup per cashier would be a query per row.
    prisma.user.findMany({
      where: { organizationId: org.id },
      select: { id: true, name: true, role: true },
    }),

    prisma.$queryRaw<StockHealthRow[]>`
      SELECT
        COUNT(DISTINCT CASE
          WHEN p."minStock" > 0 AND sl.quantity <= p."minStock" THEN sl."productId"
        END)::int AS low,
        COUNT(DISTINCT CASE
          WHEN sl.quantity <= 0 THEN sl."productId"
        END)::int AS out
      FROM "StockLevel" sl
      JOIN "Product" p ON p.id = sl."productId"
      WHERE sl."organizationId" = ${org.id}
        AND p."isActive" = true
        ${branchSql}
    `,

    prisma.product.count({
      where: {
        organizationId: org.id,
        isActive: true,
        trackExpiry: true,
        expiryDate: { gte: today.start, lte: expiryCutoff },
      },
    }),

    prisma.product.count({
      where: {
        organizationId: org.id,
        isActive: true,
        trackExpiry: true,
        expiryDate: { lt: today.start },
      },
    }),

    // Not filtered to COMPLETED: a void that happened five minutes ago is
    // exactly the kind of thing an owner opens this page to notice.
    prisma.sale.findMany({
      where: { organizationId: org.id, ...branchScope },
      orderBy: { soldAt: "desc" },
      take: 6,
      select: {
        id: true,
        receiptNo: true,
        soldAt: true,
        totalKobo: true,
        status: true,
        paymentMethod: true,
        cashier: { select: { name: true } },
      },
    }),

    // SaleItem snapshots the product name, so the leaderboard needs no join —
    // and still reads correctly for a product that was renamed or deleted since.
    prisma.saleItem.groupBy({
      by: ["productName"],
      where: {
        organizationId: org.id,
        sale: { ...completedSales, soldAt: { gte: today.start, lt: today.end } },
      },
      _sum: { quantity: true, lineTotalKobo: true },
      orderBy: { _sum: { lineTotalKobo: "desc" } },
      take: 5,
    }),

    /*
     * Prisma maps DateTime to `timestamp(3)` without a zone, storing UTC. To
     * group by the shop's own calendar day it has to be reinterpreted — hence
     * AT TIME ZONE twice — and rendered to text here rather than as a `date`,
     * because node-postgres parses a bare date into the *server's* local
     * midnight, which would shift every bucket by a day on a machine running
     * behind UTC.
     *
     * SUM over int4 promotes to bigint, which arrives as a string. A busy
     * supermarket can clear ₦21.4m in kobo in a day, so this genuinely matters.
     */
    prisma.$queryRaw<DaySalesRow[]>`
      SELECT
        to_char(s."soldAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day,
        SUM(s."totalKobo")::bigint AS revenue,
        COUNT(*)::int AS sales
      FROM "Sale" s
      WHERE s."organizationId" = ${org.id}
        AND s.status = 'COMPLETED'
        AND s."soldAt" >= ${series.start}
        AND s."soldAt" < ${series.end}
        ${branchSaleSql}
      GROUP BY 1
      ORDER BY 1
    `,

    prisma.customer.aggregate({
      where: { organizationId: org.id, balanceKobo: { gt: 0 } },
      _sum: { balanceKobo: true },
      _count: { _all: true },
    }),

    prisma.expense.aggregate({
      where: {
        organizationId: org.id,
        ...branchScope,
        expenseDate: { gte: today.start, lt: today.end },
      },
      _sum: { amountKobo: true },
      _count: { _all: true },
    }),

    prisma.subscription.findFirst({
      where: { organizationId: org.id, status: "ACTIVE" },
      orderBy: { expiresAt: "desc" },
      select: { expiresAt: true, plan: true },
    }),

    prisma.product.count({ where: { organizationId: org.id, isActive: true } }),
  ]);

  const revenueToday = todayTotals._sum.totalKobo ?? 0;
  const revenueYesterday = yesterdayTotals._sum.totalKobo ?? 0;
  const salesToday = todayTotals._count._all;
  const salesYesterday = yesterdayTotals._count._all;
  const profitToday = todayTotals._sum.profitKobo ?? 0;
  const profitYesterday = yesterdayTotals._sum.profitKobo ?? 0;
  const itemsToday = todayItems._sum.quantity ?? 0;
  const creditToday = todayTotals._sum.balanceKobo ?? 0;

  const lowStock = stockHealth[0]?.low ?? 0;
  const outOfStock = stockHealth[0]?.out ?? 0;
  const expensesToday = todayExpenses._sum.amountKobo ?? 0;
  const debtTotal = debt._sum.balanceKobo ?? 0;

  const staffById = new Map(staff.map((member) => [member.id, member]));

  const subscriptionDaysLeft = subscription
    ? daysBetween(now, subscription.expiresAt)
    : null;

  // Build the full run of days so a quiet Sunday renders as a gap rather than
  // disappearing and silently shortening the chart.
  const byDay = new Map(
    daySeries.map((row) => [row.day, { revenue: Number(row.revenue ?? 0), sales: row.sales }]),
  );
  const chart = Array.from({ length: SERIES_DAYS }, (_, index) => {
    const offset = SERIES_DAYS - 1 - index;
    const date = new Date(today.start.getTime() - offset * 86_400_000);
    const key = isoDateInZone(date, tz);
    const row = byDay.get(key);
    return {
      key,
      date,
      revenue: row?.revenue ?? 0,
      sales: row?.sales ?? 0,
      isToday: offset === 0,
    };
  });
  const chartPeak = Math.max(...chart.map((d) => d.revenue), 1);
  const chartTotal = chart.reduce((sum, d) => sum + d.revenue, 0);

  const attention =
    (canSeeProducts ? expiredCount + expiringSoon : 0) +
    (canSeeStock ? lowStock + outOfStock : 0);

  const brandNew = productCount === 0;

  // The hour in the shop's own timezone, not the server's: a server in Europe
  // must not wish a Lagos shop good morning at lunchtime.
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(now),
  );
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <>
      <PageHeader
        title={`${greeting}${user.name ? `, ${user.name.split(" ")[0]}` : ""}`}
        subtitle={`${formatDate(now, tz)}${branch ? ` · ${branch.name}` : org.name ? ` · ${org.name}` : ""}`}
      />

      {/*
        The four things people come here to DO, before any of the things they
        come here to read. Each is one tap from the first screen of the day.
      */}
      <QuickActions
        canSell={hasPermission(user, PERMISSIONS.POS_SELL)}
        canAddProduct={hasPermission(user, PERMISSIONS.PRODUCTS_CREATE)}
        canReceive={hasPermission(user, PERMISSIONS.PURCHASES_MANAGE)}
        canFileReceipt={hasPermission(user, PERMISSIONS.RECEIPTS_MANAGE)}
      />

      {/*
        The subscription warning outranks everything else on the page. A shop
        that loses its till on a Saturday morning because nobody read an email in
        November has been failed by this software, not by its own filing.
      */}
      {subscriptionDaysLeft !== null && subscriptionDaysLeft <= 30 ? (
        <div className="card card-pad mb-4 border-warn-200 bg-warn-50">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warn-700" />
            <div className="min-w-0">
              <p className="text-sm font-bold text-warn-700">
                {subscriptionDaysLeft <= 0
                  ? "Your subscription has run out"
                  : `Your subscription ends in ${subscriptionDaysLeft} ${
                      subscriptionDaysLeft === 1 ? "day" : "days"
                    }`}
              </p>
              <p className="mt-0.5 text-sm leading-relaxed text-ink-700">
                {subscription
                  ? `Cover runs to ${formatDate(subscription.expiresAt, tz)}. `
                  : ""}
                Renew before then and nothing changes — the till keeps working and
                nobody at the counter notices. Settings has the renewal details.
              </p>
              <Link href="/settings" className="btn btn-outline btn-sm mt-3">
                Renewal details
              </Link>
            </div>
          </div>
        </div>
      ) : null}

      {brandNew ? (
        <div className="mb-4">
          <EmptyState
            icon={Package}
            title="Your shop is empty — let's fill it"
            body="Add your products once and everything else follows: the till can scan them, stock starts counting down with every sale, and this page starts showing you real numbers."
            action={
              <>
                {hasPermission(user, PERMISSIONS.PRODUCTS_CREATE) ? (
                  <Link href="/products/add" className="btn btn-primary btn-sm">
                    Add a product
                  </Link>
                ) : null}
                {hasPermission(user, PERMISSIONS.PRODUCTS_IMPORT) ? (
                  <Link href="/products/import" className="btn btn-outline btn-sm">
                    Import from Excel
                  </Link>
                ) : null}
              </>
            }
          />
        </div>
      ) : null}

      {/* ── What needs attention ──────────────────────────────────────────── */}
      {attention > 0 ? (
        <RevealSection className="mb-4">
          <h2 className="section-title mb-2">Needs attention</h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {canSeeProducts && expiredCount > 0 ? (
              <StatTile
                icon={CalendarClock}
                label="Expired"
                value={String(expiredCount)}
                note={expiredCount === 1 ? "product on the shelf" : "products on the shelf"}
                href="/products?filter=expired"
                tone="bad"
              />
            ) : null}
            {canSeeProducts && expiringSoon > 0 ? (
              <StatTile
                icon={CalendarClock}
                label="Expiring soon"
                value={String(expiringSoon)}
                note={`within ${expiryWindowDays} days`}
                href="/products?filter=expiring"
                tone="warn"
              />
            ) : null}
            {canSeeStock && outOfStock > 0 ? (
              <StatTile
                icon={PackageX}
                label="Out of stock"
                value={String(outOfStock)}
                note="nothing left to sell"
                href="/stock?filter=out"
                tone="bad"
              />
            ) : null}
            {canSeeStock && lowStock > 0 ? (
              <StatTile
                icon={Package}
                label="Running low"
                value={String(lowStock)}
                note="at or below minimum"
                href="/stock?filter=low"
                tone="warn"
              />
            ) : null}
          </div>
        </RevealSection>
      ) : canSeeStock || canSeeProducts ? (
        <p className="mb-4 flex items-center gap-2 text-sm text-ink-500">
          <span className="size-1.5 rounded-full bg-good-500" />
          Nothing expiring, nothing running out. Stock and expiry dates are being
          watched.
        </p>
      ) : null}

      {/* ── Today ─────────────────────────────────────────────────────────── */}
      <RevealSection className="mb-4">
        <h2 className="section-title mb-2">Today</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            icon={Banknote}
            label="Sales today"
            value={formatNaira(revenueToday)}
            count={{ value: revenueToday, kind: "naira" }}
            delta={percentChange(revenueToday, revenueYesterday)}
            note="vs yesterday"
            accent
          />
          <StatTile
            icon={Receipt}
            label="Transactions"
            value={String(salesToday)}
            count={{ value: salesToday, kind: "number" }}
            delta={percentChange(salesToday, salesYesterday)}
            note="vs yesterday"
            href={canSeeSales ? "/sales" : undefined}
          />
          <StatTile
            icon={ShoppingBasket}
            label="Items sold"
            value={itemsToday.toLocaleString("en-NG", { maximumFractionDigits: 2 })}
            note={
              salesToday > 0
                ? `${(itemsToday / salesToday).toFixed(1)} per sale`
                : "nothing yet today"
            }
          />
          {canSeeProfit ? (
            <StatTile
              icon={TrendingUp}
              label="Profit today"
              value={formatNaira(profitToday)}
              count={{ value: profitToday, kind: "naira" }}
              delta={percentChange(profitToday, profitYesterday)}
              note={
                revenueToday > 0
                  ? `${Math.round((profitToday / revenueToday) * 100)}% margin`
                  : "vs yesterday"
              }
              tone={profitToday < 0 ? "bad" : "plain"}
            />
          ) : (
            <StatTile
              icon={Coins}
              label="Average sale"
              value={salesToday > 0 ? formatNaira(Math.round(revenueToday / salesToday)) : "—"}
              note={salesToday > 0 ? "per transaction" : "nothing yet today"}
            />
          )}
        </div>
      </RevealSection>

      {/* ── Two columns: the 14-day trend, and how today was paid ─────────── */}
      <RevealSection className="mb-4 grid gap-3 lg:grid-cols-[1.6fr_1fr]">
        <div className="card card-pad">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-bold text-ink-900">Last {SERIES_DAYS} days</h2>
            <p className="text-xs text-ink-500">
              <span className="tabular font-semibold text-ink-800">
                {formatNaira(chartTotal)}
              </span>{" "}
              in total
            </p>
          </div>

          {chartTotal === 0 ? (
            <p className="py-8 text-center text-sm text-ink-400">
              No sales recorded in this period yet.
            </p>
          ) : (
            <>
              {/*
                Bars, not a line chart and not a charting library. Fourteen
                numbers do not justify shipping 50KB of JavaScript to a shop
                owner on a metered connection, and a bar you can point at with a
                finger reads better on a phone than a line you can't.
              */}
              <div className="flex h-36 items-end gap-1.5" role="img" aria-label={`Daily sales for the last ${SERIES_DAYS} days`}>
                {chart.map((day) => {
                  const height = Math.max((day.revenue / chartPeak) * 100, day.revenue > 0 ? 3 : 1.5);
                  return (
                    <div key={day.key} className="group relative flex h-full flex-1 flex-col justify-end">
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
                      {/* Hover detail. On touch there's the table below. */}
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
                <span className="font-semibold text-ink-600">Today</span>
              </div>
            </>
          )}
        </div>

        <div className="card card-pad">
          <h2 className="mb-3 text-sm font-bold text-ink-900">How today was paid</h2>
          {byMethod.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-400">Nothing taken yet today.</p>
          ) : (
            <ul className="space-y-2.5">
              {byMethod
                .slice()
                .sort((a, b) => (b._sum.totalKobo ?? 0) - (a._sum.totalKobo ?? 0))
                .map((row) => {
                  const amount = row._sum.totalKobo ?? 0;
                  const share = revenueToday > 0 ? (amount / revenueToday) * 100 : 0;
                  return (
                    <li key={row.paymentMethod}>
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="truncate font-medium text-ink-800">
                          {PAYMENT_METHOD_LABELS[row.paymentMethod as PaymentMethod] ??
                            row.paymentMethod}
                        </span>
                        <span className="tabular shrink-0 font-semibold text-ink-950">
                          {formatNaira(amount)}
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
                          {row._count._all} {row._count._all === 1 ? "sale" : "sales"}
                        </span>
                      </div>
                    </li>
                  );
                })}
            </ul>
          )}

          {creditToday > 0 ? (
            <p className="mt-3 border-t border-hairline pt-3 text-xs leading-relaxed text-ink-500">
              <span className="font-semibold text-warn-700">
                {formatNaira(creditToday)}
              </span>{" "}
              of today&apos;s total hasn&apos;t been collected yet — it went out on
              credit.
            </p>
          ) : null}
        </div>
      </RevealSection>

      {/* ── Who sold what today ───────────────────────────────────────────── */}
      {canSeeStaffFigures ? (
        <RevealSection className="mb-4">
          <div className="card overflow-hidden">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-hairline px-4 py-3">
              <div>
                <h2 className="text-sm font-bold text-ink-900">Today, by cashier</h2>
                <p className="text-xs text-ink-500">Click a cashier to see every product they sold</p>
              </div>
              {canSeeSales ? (
                <Link href="/sales" className="text-xs font-semibold text-brand-700 hover:underline">
                  All sales
                </Link>
              ) : null}
            </div>

            {byCashier.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-ink-400">
                Nobody has rung up a sale yet today.
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
                      {canSeeProfit ? (
                        <th data-numeric className="text-right">Profit</th>
                      ) : null}
                      <th className="w-28">Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byCashier.map((row) => {
                      const member = staffById.get(row.cashierId);
                      const amount = row._sum.totalKobo ?? 0;
                      const count = row._count._all;
                      const share = revenueToday > 0 ? (amount / revenueToday) * 100 : 0;
                      return (
                        <tr key={row.cashierId} className="relative cursor-pointer hover:bg-navy-50">
                          <td>
                            {/* The link stretches over the whole row, so any part of it opens this cashier's day. */}
                            <Link
                              href={`/sales/cashier/${row.cashierId}`}
                              className="flex items-center gap-2 after:absolute after:inset-0 after:content-['']"
                              aria-label={`See everything ${member?.name ?? "this cashier"} sold today`}
                            >
                              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-ink-100 text-[0.6875rem] font-bold text-ink-600">
                                {initials(member?.name ?? "?")}
                              </span>
                              <span className="truncate font-medium text-ink-900">
                                {/* A deleted staff account leaves its sales behind. */}
                                {member?.name ?? "Removed account"}
                              </span>
                            </Link>
                          </td>
                          <td data-numeric className="text-right">{count}</td>
                          <td data-numeric className="text-right font-semibold text-ink-950">
                            {formatNaira(amount)}
                          </td>
                          <td data-numeric className="text-right text-ink-600">
                            {count > 0 ? formatNaira(Math.round(amount / count)) : "—"}
                          </td>
                          {canSeeProfit ? (
                            <td data-numeric className="text-right text-ink-600">
                              {formatNaira(row._sum.profitKobo ?? 0)}
                            </td>
                          ) : null}
                          <td>
                            <span className="flex items-center justify-end gap-2">
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
        </RevealSection>
      ) : null}

      {/* ── Recent sales + best sellers ───────────────────────────────────── */}
      <RevealSection className="mb-4 grid gap-3 lg:grid-cols-2">
        <div className="card overflow-hidden">
          <div className="flex items-baseline justify-between gap-2 border-b border-hairline px-4 py-3">
            <h2 className="text-sm font-bold text-ink-900">Latest sales</h2>
            {canSeeSales ? (
              <Link href="/sales" className="text-xs font-semibold text-brand-700 hover:underline">
                See all
              </Link>
            ) : null}
          </div>

          {recentSales.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-ink-400">
              No sales recorded yet.
            </p>
          ) : (
            <ul className="divide-y divide-ink-50">
              {recentSales.map((sale) => {
                const row = (
                  <span className="flex items-center gap-3 px-4 py-2.5">
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-ink-50">
                      <ReceiptText className="size-4 text-ink-400" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="tabular truncate text-sm font-semibold text-ink-900">
                          {sale.receiptNo}
                        </span>
                        {sale.status !== "COMPLETED" ? (
                          <span className="badge badge-bad">{sale.status.toLowerCase()}</span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-ink-500">
                        {formatTime(sale.soldAt, tz)} · {sale.cashier.name} ·{" "}
                        {PAYMENT_METHOD_LABELS[sale.paymentMethod as PaymentMethod] ??
                          sale.paymentMethod}
                      </span>
                    </span>
                    <span
                      className={`tabular shrink-0 text-sm font-bold ${
                        sale.status === "COMPLETED" ? "text-ink-950" : "text-ink-400 line-through"
                      }`}
                    >
                      {formatNaira(sale.totalKobo)}
                    </span>
                  </span>
                );
                return (
                  <li key={sale.id}>
                    {canSeeSales ? (
                      <Link href={`/sales/${sale.id}`} className="block hover:bg-brand-50">
                        {row}
                      </Link>
                    ) : (
                      row
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="card overflow-hidden">
          <div className="border-b border-hairline px-4 py-3">
            <h2 className="text-sm font-bold text-ink-900">Today&apos;s best sellers</h2>
          </div>

          {topProducts.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-ink-400">
              Nothing sold yet today.
            </p>
          ) : (
            <ul className="divide-y divide-ink-50">
              {topProducts.map((row, index) => (
                <li key={row.productName} className="flex items-center gap-3 px-4 py-2.5">
                  <span
                    className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold ${
                      index === 0 ? "bg-brand-50 text-brand-700" : "bg-ink-50 text-ink-500"
                    }`}
                  >
                    {index === 0 ? <Trophy className="size-3.5" /> : index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink-900">
                      {row.productName}
                    </span>
                    <span className="tabular mt-0.5 block text-xs text-ink-500">
                      {(row._sum.quantity ?? 0).toLocaleString("en-NG", {
                        maximumFractionDigits: 2,
                      })}{" "}
                      sold
                    </span>
                  </span>
                  <span className="tabular shrink-0 text-sm font-semibold text-ink-950">
                    {formatNairaCompact(row._sum.lineTotalKobo ?? 0)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </RevealSection>

      {/* ── Money owed and money out ──────────────────────────────────────── */}
      {canSeeDebt || canSeeExpenses ? (
        <RevealSection>
          <h2 className="section-title mb-2">The rest of the business</h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {canSeeDebt ? (
              <StatTile
                icon={UserRound}
                label="Owed to you"
                value={formatNaira(debtTotal)}
                note={`${debt._count._all} ${
                  debt._count._all === 1 ? "customer" : "customers"
                } on credit`}
                href="/customers?filter=debt"
                tone={debtTotal > 0 ? "warn" : "plain"}
              />
            ) : null}
            {canSeeExpenses ? (
              <StatTile
                icon={Wallet}
                label="Spent today"
                value={formatNaira(expensesToday)}
                note={`${todayExpenses._count._all} ${
                  todayExpenses._count._all === 1 ? "entry" : "entries"
                }`}
                href="/expenses"
              />
            ) : null}
            {canSeeProfit && canSeeExpenses ? (
              <StatTile
                icon={Coins}
                label="Net today"
                value={formatNaira(profitToday - expensesToday)}
                note="profit less expenses"
                tone={profitToday - expensesToday < 0 ? "bad" : "good"}
              />
            ) : null}
            {canSeeProducts ? (
              <StatTile
                icon={Package}
                label="Products"
                value={productCount.toLocaleString("en-NG")}
                note="active in the catalogue"
                href="/products"
              />
            ) : null}
          </div>
        </RevealSection>
      ) : null}
    </>
  );
}

/** "Chidi Okonkwo" → "CO". Two letters is all the circle fits. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}
