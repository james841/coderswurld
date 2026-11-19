import { CountUp } from "@/components/motion";
import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CircleDollarSign,
  Clock,
  Inbox,
} from "lucide-react";

import { prisma } from "@/lib/db";
import { formatDate, relativeDays } from "@/lib/dates";
import { formatNairaCompact } from "@/lib/money";
import { LeadStatusBadge, OrgStatusBadge } from "../StatusBadges";

export const metadata: Metadata = { title: "Overview" };

/**
 * The operator's home screen.
 *
 * It answers, in order of urgency: who is waiting on me, whose subscription is
 * about to lapse, and how the business is doing. Anything that needs the
 * operator to act is at the top and links straight to the thing to act on —
 * a dashboard that reports a number without offering the next click is just a
 * prettier way of making someone go and find it themselves.
 */
export default async function PlatformOverviewPage() {
  const now = new Date();
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));

  // One round trip. These are all cheap indexed aggregates, and issuing them in
  // parallel keeps the page a single database wait rather than seven.
  const [
    openLeads,
    activeOrgs,
    pendingOrgs,
    expiringSoon,
    collectedThisYear,
    recentLeads,
    lapsing,
  ] = await Promise.all([
    prisma.lead.count({ where: { status: { in: ["NEW", "CONTACTED", "INVOICED", "CLAIMED", "PAID"] } } }),
    prisma.organization.count({ where: { status: "ACTIVE" } }),
    prisma.organization.count({ where: { status: { in: ["PENDING", "SUSPENDED", "EXPIRED"] } } }),
    prisma.subscription.count({
      where: { status: "ACTIVE", expiresAt: { gte: now, lt: in30Days } },
    }),
    prisma.subscription.aggregate({
      where: { paidAt: { gte: yearStart } },
      _sum: { amountPaidKobo: true },
    }),
    prisma.lead.findMany({
      orderBy: { createdAt: "desc" },
      take: 6,
      select: {
        id: true,
        reference: true,
        companyName: true,
        plan: true,
        status: true,
        createdAt: true,
        city: true,
        state: true,
      },
    }),
    prisma.subscription.findMany({
      where: { status: "ACTIVE", expiresAt: { lt: in30Days } },
      orderBy: { expiresAt: "asc" },
      take: 6,
      select: {
        id: true,
        expiresAt: true,
        plan: true,
        organization: { select: { id: true, name: true, status: true } },
      },
    }),
  ]);

  return (
    <div className="space-y-6">
      {/* Banner: the console's one bold block, in the brand poster style. */}
      <div className="texture-waves relative overflow-hidden rounded-3xl bg-navy-700 px-6 py-7 text-white sm:px-8">
        <div className="pointer-events-none absolute -right-16 -top-24 hidden size-72 rounded-full bg-brand-500/90 sm:block" />
        <div className="texture-waves pointer-events-none absolute -right-16 -top-24 hidden size-72 rounded-full sm:block" />
        <div className="relative">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-navy-100">Platform overview</p>
          <h1 className="mt-1.5 text-2xl font-bold tracking-tight sm:text-3xl">
            {openLeads > 0
              ? `${openLeads} plan request${openLeads === 1 ? "" : "s"} waiting on you`
              : "You're all caught up"}
          </h1>
          <p className="mt-1 max-w-xl text-sm text-navy-100">
            Everything waiting on you, and how the business is tracking.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link href="/platform/leads" className="btn btn-sm rounded-full bg-white px-4 text-navy-900 hover:bg-navy-50">
              Plan requests
            </Link>
            <Link href="/platform/organizations/new" className="btn btn-primary btn-sm rounded-full px-4">
              Add a business
            </Link>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat
          tone="navy"
          label="Open requests"
          value={openLeads}
          href="/platform/leads"
          icon={Inbox}
          urgent={openLeads > 0}
          caption={openLeads === 0 ? "Nothing waiting" : "Needs a reply"}
        />
        <Stat
          label="Active businesses"
          value={activeOrgs}
          href="/platform/organizations?status=ACTIVE"
          icon={Building2}
          tone="good"
          caption={pendingOrgs > 0 ? `${pendingOrgs} not trading` : "All trading"}
        />
        <Stat
          label="Expiring in 30 days"
          value={expiringSoon}
          href="/platform/subscriptions"
          icon={Clock}
          tone="orange"
          urgent={expiringSoon > 0}
          caption={expiringSoon === 0 ? "None due" : "Chase renewals"}
        />
        <Stat
          label={`Collected in ${now.getUTCFullYear()}`}
          value={formatNairaCompact(collectedThisYear._sum.amountPaidKobo ?? 0)}
          icon={CircleDollarSign}
          tone="red"
          caption="Confirmed payments"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── Latest requests ─────────────────────────────────────────────── */}
        <section className="card overflow-hidden rounded-3xl">
          <header className="flex items-center justify-between border-b border-hairline px-4 py-3">
            <h2 className="text-sm font-bold text-ink-950">Latest requests</h2>
            <Link
              href="/platform/leads"
              className="inline-flex items-center gap-1 text-xs font-semibold text-navy-700 hover:text-navy-900"
            >
              See all
              <ArrowRight className="size-3.5" />
            </Link>
          </header>

          {recentLeads.length === 0 ? (
            <Empty
              icon={Inbox}
              title="No requests yet"
              body="Plan requests from the landing page land here."
            />
          ) : (
            <ul className="divide-y divide-hairline">
              {recentLeads.map((lead) => (
                <li key={lead.id}>
                  <Link
                    href={`/platform/leads/${lead.id}`}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-navy-50"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink-900">
                        {lead.companyName}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-ink-500">
                        <span className="font-mono">{lead.reference}</span>
                        {" · "}
                        {lead.plan.charAt(0) + lead.plan.slice(1).toLowerCase()}
                        {lead.city || lead.state
                          ? ` · ${[lead.city, lead.state].filter(Boolean).join(", ")}`
                          : ""}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <LeadStatusBadge status={lead.status} />
                      <p className="mt-1 text-[0.6875rem] text-ink-400">
                        {relativeDays(lead.createdAt, now)}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Renewals due ────────────────────────────────────────────────── */}
        <section className="card overflow-hidden rounded-3xl">
          <header className="flex items-center justify-between border-b border-hairline px-4 py-3">
            <h2 className="text-sm font-bold text-ink-950">Renewals due</h2>
            <Link
              href="/platform/subscriptions"
              className="inline-flex items-center gap-1 text-xs font-semibold text-navy-700 hover:text-navy-900"
            >
              See all
              <ArrowRight className="size-3.5" />
            </Link>
          </header>

          {lapsing.length === 0 ? (
            <Empty
              icon={Clock}
              title="Nothing due"
              body="No subscription expires in the next 30 days."
            />
          ) : (
            <ul className="divide-y divide-hairline">
              {lapsing.map((subscription) => {
                const overdue = subscription.expiresAt.getTime() < now.getTime();
                return (
                  <li key={subscription.id}>
                    <Link
                      href={`/platform/organizations/${subscription.organization.id}`}
                      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-navy-50"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-ink-900">
                          {subscription.organization.name}
                        </p>
                        <p className="mt-0.5 text-xs text-ink-500">
                          {subscription.plan.charAt(0) +
                            subscription.plan.slice(1).toLowerCase()}
                          {" · "}
                          {formatDate(subscription.expiresAt)}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <span className={`badge ${overdue ? "badge-bad" : "badge-warn"}`}>
                          {overdue ? (
                            <>
                              <AlertTriangle className="size-3" />
                              Lapsed
                            </>
                          ) : (
                            relativeDays(subscription.expiresAt, now)
                          )}
                        </span>
                        <p className="mt-1">
                          <OrgStatusBadge status={subscription.organization.status} />
                        </p>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

const STAT_TONES = {
  navy: "bg-navy-700",
  good: "bg-good-700",
  orange: "bg-brand-700",
  red: "bg-sell-600",
} as const;

function Stat({
  label,
  value,
  caption,
  href,
  icon: Icon,
  urgent,
  tone,
}: {
  label: string;
  value: string | number;
  caption?: string;
  href?: string;
  icon: React.ComponentType<{ className?: string }>;
  urgent?: boolean;
  tone: keyof typeof STAT_TONES;
}) {
  const inner = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className={`texture-waves grid size-11 shrink-0 place-items-center rounded-2xl text-white ${STAT_TONES[tone]}`}>
          <Icon className="size-5" />
        </span>
        {urgent ? <span className="badge badge-warn">Needs you</span> : null}
      </div>
      <p className="mt-4 text-xs font-bold uppercase tracking-wider text-ink-500">{label}</p>
      <p className="tabular mt-1 text-2xl font-bold tracking-tight text-ink-950 sm:text-3xl">
        {typeof value === "number" ? <CountUp value={value} /> : value}
      </p>
      {caption ? <p className="mt-0.5 text-sm text-ink-500">{caption}</p> : null}
    </>
  );

  const shell =
    "card card-pad rounded-3xl transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-raised)]";
  if (!href) return <div className={shell}>{inner}</div>;
  return (
    <Link href={href} className={shell}>
      {inner}
    </Link>
  );
}

function Empty({
  icon: Icon,
  title,
  body,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
}) {
  return (
    <div className="px-4 py-10 text-center">
      <span className="mx-auto mb-3 grid size-10 place-items-center rounded-full bg-ink-50 text-ink-400">
        <Icon className="size-5" />
      </span>
      <p className="text-sm font-semibold text-ink-800">{title}</p>
      <p className="mt-0.5 text-xs text-ink-500">{body}</p>
    </div>
  );
}
