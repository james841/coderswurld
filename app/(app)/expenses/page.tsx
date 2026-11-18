import { requireTenant } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { hasPermission } from "@/lib/permissions";
import { PERMISSIONS } from "@/lib/constants";
import { monthRange, isoDateInZone, DEFAULT_LOCALE } from "@/lib/dates";

import { PageHeader } from "@/components/ui/PageHeader";
import { NoAccess } from "@/components/ui/NoAccess";
import { ExpensesClient, type ExpenseRow } from "./ExpensesClient";

/**
 * Expenses — the running cost of keeping the shop open, read one month at a time.
 *
 * A shop's money question is monthly: rent, light, salaries all land on that
 * cycle, so the page opens on the current month and lets the owner page back. The
 * server resolves which month to show, totals it, and hands finished rows down —
 * the client only talks to the API to add, correct or remove an entry.
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "Expenses" };

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireTenant();
  const { org, user } = session;

  if (!hasPermission(user, PERMISSIONS.EXPENSES_VIEW)) {
    return <NoAccess what="expenses" />;
  }

  const params = await searchParams;
  const monthParam = typeof params.month === "string" ? params.month : null;

  // Which month are we looking at? The anchor is a safe mid-month instant that
  // monthRange pins to the org's zone; everything else is derived from it.
  const anchor = parseMonthAnchor(monthParam);
  const { start, end } = monthRange(anchor, org.timezone);

  const [expenses, branches] = await Promise.all([
    prisma.expense.findMany({
      where: { organizationId: org.id, expenseDate: { gte: start, lt: end } },
      orderBy: { expenseDate: "desc" },
      select: {
        id: true,
        category: true,
        amountKobo: true,
        description: true,
        vendor: true,
        paymentMethod: true,
        expenseDate: true,
        branchId: true,
        user: { select: { name: true } },
      },
    }),
    prisma.branch.findMany({
      where: { organizationId: org.id, isActive: true },
      orderBy: [{ isMain: "desc" }, { name: "asc" }],
      select: { id: true, name: true, code: true, isMain: true },
    }),
  ]);

  const rows: ExpenseRow[] = expenses.map((e) => ({
    id: e.id,
    category: e.category,
    amountKobo: e.amountKobo,
    description: e.description,
    vendor: e.vendor,
    paymentMethod: e.paymentMethod,
    expenseDate: e.expenseDate.toISOString(),
    branchId: e.branchId,
    userName: e.user?.name ?? null,
  }));

  const totalKobo = rows.reduce((sum, r) => sum + r.amountKobo, 0);

  const monthKey = isoDateInZone(anchor, org.timezone).slice(0, 7); // "YYYY-MM"
  const nowKey = isoDateInZone(new Date(), org.timezone).slice(0, 7);
  const monthLabel = new Intl.DateTimeFormat(DEFAULT_LOCALE, {
    timeZone: org.timezone,
    month: "long",
    year: "numeric",
  }).format(anchor);

  // You can file an expense for a day you forgot, but not for a month that hasn't
  // happened — so "next" is withheld once you're on the current month.
  const atCurrentMonth = monthKey >= nowKey;

  const defaultBranchId =
    session.branch?.id ??
    branches.find((b) => b.isMain)?.id ??
    branches[0]?.id ??
    "";

  return (
    <>
      <PageHeader
        title="Expenses"
        subtitle="What you spend to keep the shop running"
      />
      <ExpensesClient
        initial={rows}
        branches={branches.map((b) => ({ id: b.id, name: b.name, code: b.code }))}
        defaultBranchId={defaultBranchId}
        multiBranch={branches.length > 1}
        canManage={hasPermission(user, PERMISSIONS.EXPENSES_MANAGE)}
        totalKobo={totalKobo}
        monthLabel={monthLabel}
        prevMonth={addMonths(monthKey, -1)}
        nextMonth={atCurrentMonth ? null : addMonths(monthKey, 1)}
        timezone={org.timezone}
      />
    </>
  );
}

/** A mid-month noon-UTC instant for the requested month, or now if malformed. */
function parseMonthAnchor(month: string | null): Date {
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const [y, m] = month.split("-").map(Number);
    if (m >= 1 && m <= 12) return new Date(Date.UTC(y, m - 1, 15, 12));
  }
  return new Date();
}

/** Shift a "YYYY-MM" key by whole months, carrying the year. */
function addMonths(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const index = y * 12 + (m - 1) + delta;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}
