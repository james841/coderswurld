import { ConsoleHeading } from "../../ConsoleHeading";
import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowRight, CalendarClock, CircleCheck, Phone, TrendingUp, Wallet, Receipt } from "lucide-react";

import { prisma } from "@/lib/db";
import { daysBetween, formatDate } from "@/lib/dates";
import { formatNaira, formatNairaCompact } from "@/lib/money";
import { OrgStatusBadge, PlanBadge } from "../../StatusBadges";

export const metadata: Metadata = { title: "Renewals" };

/**
 * Money in, and money about to stop coming in.
 *
 * This is the one screen in the console with a job rather than a subject: it
 * exists so the operator can work a list of phone calls in order of urgency and
 * reach the end of it. Overdue at the top, then this month, then next — and
 * nothing else, because an account expiring in August is not a task in April.
 *
 * Yearly upfront billing makes renewals the entire revenue cycle. A customer who
 * quietly lapses is not a dunning problem that resolves itself next month; they
 * are gone until somebody notices. So the cost of missing one is a whole year,
 * which is what earns this its own tab.
 */

/** Anything inside this window is a call to make now. */
const URGENT_DAYS = 14;
const SOON_DAYS = 45;

export default async function SubscriptionsPage() {
  const now = new Date();
  const urgentBy = new Date(now);
  urgentBy.setDate(urgentBy.getDate() + URGENT_DAYS);
  const soonBy = new Date(now);
  soonBy.setDate(soonBy.getDate() + SOON_DAYS);

  const yearStart = new Date(now.getFullYear(), 0, 1);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [due, lifetime, thisYear, thisMonth, activeCount, recent] = await Promise.all([
    // One query for everything still on the books, sorted by urgency. The
    // platform sells to hundreds, not hundreds of thousands, so 200 rows is the
    // whole working set and paginating it would only hide work.
    prisma.subscription.findMany({
      where: { status: "ACTIVE", expiresAt: { lte: soonBy } },
      orderBy: { expiresAt: "asc" },
      take: 200,
      select: {
        id: true,
        plan: true,
        expiresAt: true,
        amountKobo: true,
        amountPaidKobo: true,
        organization: {
          select: {
            id: true,
            name: true,
            status: true,
            phone: true,
            city: true,
            state: true,
          },
        },
      },
    }),
    prisma.subscription.aggregate({ _sum: { amountPaidKobo: true } }),
    prisma.subscription.aggregate({
      where: { paidAt: { gte: yearStart } },
      _sum: { amountPaidKobo: true },
      _count: { _all: true },
    }),
    prisma.subscription.aggregate({
      where: { paidAt: { gte: monthStart } },
      _sum: { amountPaidKobo: true },
      _count: { _all: true },
    }),
    prisma.organization.count({ where: { status: "ACTIVE" } }),
    prisma.subscription.findMany({
      where: { paidAt: { not: null } },
      orderBy: { paidAt: "desc" },
      take: 8,
      select: {
        id: true,
        plan: true,
        amountPaidKobo: true,
        paidAt: true,
        paymentMethod: true,
        organization: { select: { id: true, name: true } },
      },
    }),
  ]);

  const overdue = due.filter((row) => row.expiresAt.getTime() < now.getTime());
  const urgent = due.filter(
    (row) =>
      row.expiresAt.getTime() >= now.getTime() && row.expiresAt.getTime() <= urgentBy.getTime(),
  );
  const soon = due.filter((row) => row.expiresAt.getTime() > urgentBy.getTime());

  /**
   * What is at stake in the next 45 days, priced at what each customer last
   * actually paid rather than at list price — the figure to chase is the one
   * they've shown they'll pay.
   */
  const atRiskKobo = due.reduce(
    (sum, row) => sum + (row.amountPaidKobo || row.amountKobo),
    0,
  );

  return (
    <div className="space-y-5">
      <ConsoleHeading icon={Receipt} title="Renewals and payments">
          Everything expiring in the next {SOON_DAYS} days, most urgent first.
        </ConsoleHeading>

      {/* ── Money ─────────────────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={Wallet}
          label="Collected this month"
          value={formatNairaCompact(thisMonth._sum.amountPaidKobo ?? 0)}
          note={`${thisMonth._count._all} ${thisMonth._count._all === 1 ? "payment" : "payments"}`}
        />
        <Stat
          icon={TrendingUp}
          label={`Collected in ${now.getFullYear()}`}
          value={formatNairaCompact(thisYear._sum.amountPaidKobo ?? 0)}
          note={`${thisYear._count._all} ${thisYear._count._all === 1 ? "payment" : "payments"}`}
        />
        <Stat
          icon={CircleCheck}
          label="All time"
          value={formatNairaCompact(lifetime._sum.amountPaidKobo ?? 0)}
          note={`${activeCount} ${activeCount === 1 ? "business" : "businesses"} active now`}
        />
        <Stat
          icon={CalendarClock}
          label={`Due within ${SOON_DAYS} days`}
          value={formatNairaCompact(atRiskKobo)}
          note={`${due.length} ${due.length === 1 ? "account" : "accounts"} to chase`}
          urgent={overdue.length > 0}
        />
      </div>

      {/* ── The list to work ──────────────────────────────────────────────── */}
      {due.length === 0 ? (
        <div className="card card-pad text-center">
          <div className="mx-auto mb-3 grid size-11 place-items-center rounded-full bg-good-50">
            <CircleCheck className="size-5 text-good-700" />
          </div>
          <p className="text-sm font-semibold text-ink-900">Nothing to chase.</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-ink-500">
            No subscription expires in the next {SOON_DAYS} days. This screen will
            fill up on its own — there is nothing to check in the meantime.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          <Group
            title="Already lapsed"
            note="These businesses cannot trade. Call them today."
            rows={overdue}
            now={now}
            tone="bad"
          />
          <Group
            title={`Expiring within ${URGENT_DAYS} days`}
            note="Still trading, but not for long."
            rows={urgent}
            now={now}
            tone="warn"
          />
          <Group
            title="Coming up"
            note={`Between ${URGENT_DAYS} and ${SOON_DAYS} days out. Worth a heads-up, not a chase.`}
            rows={soon}
            now={now}
            tone="calm"
          />
        </div>
      )}

      {/* ── Recent payments ───────────────────────────────────────────────── */}
      {recent.length > 0 ? (
        <section className="card">
          <header className="border-b border-hairline px-4 py-3">
            <h2 className="text-sm font-bold text-ink-950">Last payments in</h2>
          </header>
          <ul className="divide-y divide-hairline">
            {recent.map((row) => (
              <li key={row.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/platform/organizations/${row.organization.id}`}
                    className="truncate text-sm font-semibold text-ink-900 hover:text-brand-700"
                  >
                    {row.organization.name}
                  </Link>
                  <p className="text-xs text-ink-500">
                    {row.paidAt ? formatDate(row.paidAt) : "—"}
                    {row.paymentMethod
                      ? ` · ${row.paymentMethod.replace("_", " ").toLowerCase()}`
                      : ""}
                  </p>
                </div>
                <PlanBadge plan={row.plan} />
                <p className="tabular shrink-0 text-sm font-bold text-ink-950">
                  {formatNaira(row.amountPaidKobo)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

type Row = {
  id: string;
  plan: string;
  expiresAt: Date;
  amountKobo: number;
  amountPaidKobo: number;
  organization: {
    id: string;
    name: string;
    status: string;
    phone: string;
    city: string | null;
    state: string | null;
  };
};

function Group({
  title,
  note,
  rows,
  now,
  tone,
}: {
  title: string;
  note: string;
  rows: Row[];
  now: Date;
  tone: "bad" | "warn" | "calm";
}) {
  if (rows.length === 0) return null;

  const accent =
    tone === "bad"
      ? "border-bad-200 bg-bad-50"
      : tone === "warn"
        ? "border-warn-200 bg-warn-50"
        : "border-hairline bg-ink-50";

  return (
    <section className="card overflow-hidden">
      <header className={`border-b px-4 py-3 ${accent}`}>
        <h2 className="flex items-center gap-2 text-sm font-bold text-ink-950">
          {tone !== "calm" ? (
            <AlertTriangle
              className={`size-4 ${tone === "bad" ? "text-bad-700" : "text-warn-700"}`}
            />
          ) : null}
          {title}
          <span className="tabular text-xs font-bold text-ink-500">{rows.length}</span>
        </h2>
        <p className="mt-0.5 text-xs text-ink-600">{note}</p>
      </header>

      <ul className="divide-y divide-hairline">
        {rows.map((row) => {
          const days = daysBetween(now, row.expiresAt);
          return (
            <li key={row.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/platform/organizations/${row.organization.id}`}
                    className="truncate text-sm font-bold text-ink-950 hover:text-brand-700"
                  >
                    {row.organization.name}
                  </Link>
                  <OrgStatusBadge status={row.organization.status} />
                  <PlanBadge plan={row.plan} />
                </div>
                <p className="mt-0.5 text-xs text-ink-500">
                  {days < 0
                    ? `lapsed ${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"} ago`
                    : days === 0
                      ? "expires today"
                      : `${days} ${days === 1 ? "day" : "days"} left`}
                  {" · "}
                  {formatDate(row.expiresAt)}
                  {row.organization.city ? ` · ${row.organization.city}` : ""}
                </p>
              </div>

              <p className="tabular shrink-0 text-sm font-bold text-ink-950">
                {formatNaira(row.amountPaidKobo || row.amountKobo)}
              </p>

              {/* The two things the operator does from this row, in reach. */}
              <div className="flex shrink-0 gap-1.5">
                <a
                  href={`tel:${row.organization.phone}`}
                  className="btn btn-outline btn-sm"
                  aria-label={`Call ${row.organization.name}`}
                >
                  <Phone className="size-4" />
                  Call
                </a>
                <Link
                  href={`/platform/organizations/${row.organization.id}`}
                  className="btn btn-dark btn-sm"
                >
                  Record payment
                  <ArrowRight className="size-4" />
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  note,
  urgent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  note: string;
  urgent?: boolean;
}) {
  return (
    <div className={`card card-pad ${urgent ? "border-warn-200 bg-warn-50" : ""}`}>
      <div className="flex items-center gap-2">
        <Icon className={`size-4 ${urgent ? "text-warn-700" : "text-ink-400"}`} />
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</p>
      </div>
      <p className="tabular mt-1.5 text-2xl font-bold tracking-tight text-ink-950">{value}</p>
      <p className="mt-0.5 text-xs text-ink-500">{note}</p>
    </div>
  );
}
