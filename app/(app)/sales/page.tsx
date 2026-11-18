import { requireTenant } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { hasPermission } from "@/lib/permissions";
import { PERMISSIONS } from "@/lib/constants";
import { dayRange, isoDateInZone, DEFAULT_LOCALE } from "@/lib/dates";

import { PageHeader } from "@/components/ui/PageHeader";
import { NoAccess } from "@/components/ui/NoAccess";
import { SalesClient, type SaleListRow } from "./SalesClient";

/**
 * Sales — the day's takings, one receipt per row.
 *
 * A shop's first question every evening is "how did we do today, and who sold
 * what?", so the page opens on today and pages back a day at a time. The server
 * resolves which day, pulls that day's receipts and hands them down finished —
 * the client only filters, searches and totals what it was given.
 *
 * WHOSE SALES YOU SEE
 * -------------------
 * A cashier with plain `sales.view` sees only the receipts they rang up; the
 * query is scoped to them before it leaves the server, not hidden afterwards.
 * `sales.view_all` lifts that scope — the manager sees the whole floor and can
 * filter by cashier. The distinction is enforced here, so a crafted request can
 * never widen it.
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "Sales" };

const TAKE = 1000;

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireTenant();
  const { org, user } = session;

  if (!hasPermission(user, PERMISSIONS.SALES_VIEW)) {
    return <NoAccess what="sales" />;
  }

  const canViewAll = hasPermission(user, PERMISSIONS.SALES_VIEW_ALL);
  const canSell = hasPermission(user, PERMISSIONS.POS_SELL);

  const params = await searchParams;
  const dateParam = typeof params.date === "string" ? params.date : null;

  // Which day are we looking at? A safe noon-UTC anchor that dayRange pins to the
  // org's zone; everything else is derived from it.
  const anchor = parseDayAnchor(dateParam);
  const { start, end } = dayRange(anchor, org.timezone);

  // Own sales only, unless the user may see the whole floor.
  const scope = canViewAll ? {} : { cashierId: user.id };
  const where = {
    organizationId: org.id,
    soldAt: { gte: start, lt: end },
    ...scope,
  };

  const [rows, totalCount] = await Promise.all([
    prisma.sale.findMany({
      where,
      orderBy: { soldAt: "desc" },
      take: TAKE,
      select: {
        id: true,
        receiptNo: true,
        soldAt: true,
        totalKobo: true,
        paidKobo: true,
        balanceKobo: true,
        changeKobo: true,
        paymentMethod: true,
        priceMode: true,
        status: true,
        cashier: { select: { id: true, name: true } },
        customer: { select: { name: true } },
        _count: { select: { items: true } },
      },
    }),
    prisma.sale.count({ where }),
  ]);

  const list: SaleListRow[] = rows.map((s) => ({
    id: s.id,
    receiptNo: s.receiptNo,
    soldAt: s.soldAt.toISOString(),
    totalKobo: s.totalKobo,
    paidKobo: s.paidKobo,
    balanceKobo: s.balanceKobo,
    changeKobo: s.changeKobo,
    paymentMethod: s.paymentMethod,
    priceMode: s.priceMode,
    status: s.status,
    cashierId: s.cashier.id,
    cashierName: s.cashier.name,
    customerName: s.customer?.name ?? null,
    itemCount: s._count.items,
  }));

  const dayKey = isoDateInZone(anchor, org.timezone); // "YYYY-MM-DD"
  const todayKey = isoDateInZone(new Date(), org.timezone);
  // You can't sell into the future, so "next" is withheld once you reach today.
  const isToday = dayKey >= todayKey;

  return (
    <>
      <PageHeader title="Sales" subtitle="Every receipt rung up at the till" />
      <SalesClient
        initial={list}
        canViewAll={canViewAll}
        canSell={canSell}
        timezone={org.timezone}
        dateLabel={dayLabel(dayKey, todayKey, anchor, org.timezone)}
        prevDate={addDays(dayKey, -1)}
        nextDate={isToday ? null : addDays(dayKey, 1)}
        isToday={isToday}
        truncated={totalCount > TAKE}
        totalCount={totalCount}
      />
    </>
  );
}

/** A noon-UTC instant on the requested day, or now if the param is malformed. */
function parseDayAnchor(date: string | null): Date {
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const anchor = new Date(`${date}T12:00:00.000Z`);
    if (!Number.isNaN(anchor.getTime())) return anchor;
  }
  return new Date();
}

/** Shift a "YYYY-MM-DD" key by whole days in UTC, free of DST surprises. */
function addDays(key: string, delta: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** "Today" / "Yesterday" when near, otherwise the full written date. */
function dayLabel(dayKey: string, todayKey: string, anchor: Date, timeZone: string): string {
  if (dayKey === todayKey) return "Today";
  if (dayKey === addDays(todayKey, -1)) return "Yesterday";
  return new Intl.DateTimeFormat(DEFAULT_LOCALE, {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(anchor);
}
