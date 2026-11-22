import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Building2,
  CalendarClock,
  CircleDollarSign,
  Eye,
  Inbox,
  MailWarning,
  Plus,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import { CountUp } from "@/components/motion";
import { prisma } from "@/lib/db";
import { formatDate, relativeDays } from "@/lib/dates";
import { formatNaira, formatNairaCompact } from "@/lib/money";
import { PLANS, type PlanId } from "@/lib/constants";
import { LeadStatusBadge, OrgStatusBadge } from "../StatusBadges";

export const metadata: Metadata = { title: "Overview" };

const TZ = "Africa/Lagos";

/** "2026-11" for a date, in Lagos time. */
function monthKey(d: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit" }).formatToParts(d);
  return `${parts.find((p) => p.type === "year")!.value}-${parts.find((p) => p.type === "month")!.value}`;
}

function greeting(now: Date) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }).format(now));
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

/** Percent change, or null when there is nothing to compare with. */
function change(now: number, before: number): number | null {
  if (before <= 0) return null;
  return Math.round(((now - before) / before) * 100);
}

/**
 * The operator's home screen.
 *
 * Top to bottom, in order of urgency: what needs you now, how the business is
 * doing this month, the year's money, the sales pipeline, then the latest
 * requests, renewals and new shops. Everything that reports a problem links
 * straight to where you fix it.
 */
export default async function PlatformOverviewPage() {
  const now = new Date();
  const day = 86_400_000;
  const in30Days = new Date(now.getTime() + 30 * day);
  const thisMonth = monthKey(now);
  const yearAgo = new Date(now.getTime() - 365 * day);
  const monthStart = new Date(`${thisMonth}-01T00:00:00+01:00`);
  const week = new Date(now.getTime() - 7 * day);
  const twoWeeks = new Date(now.getTime() - 14 * day);

  const [
    leadGroups,
    activeOrgs,
    notTrading,
    newOrgs,
    expiringSoon,
    payments,
    activePlans,
    visitors,
    failedEmails,
    recentLeads,
    lapsing,
    newestOrgs,
  ] = await Promise.all([
    prisma.lead.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.organization.count({ where: { status: "ACTIVE" } }),
    prisma.organization.count({ where: { status: { in: ["PENDING", "SUSPENDED", "EXPIRED"] } } }),
    prisma.organization.count({ where: { createdAt: { gte: monthStart } } }),
    prisma.subscription.count({ where: { status: "ACTIVE", expiresAt: { gte: now, lt: in30Days } } }),
    prisma.subscription.findMany({
      where: { paidAt: { gte: yearAgo }, amountPaidKobo: { gt: 0 } },
      select: { paidAt: true, amountPaidKobo: true },
    }),
    prisma.subscription.groupBy({ by: ["plan"], where: { status: "ACTIVE" }, _count: { _all: true } }),
    prisma.$queryRaw<{ recent: bigint; before: bigint }[]>`
      SELECT count(DISTINCT "visitorId") FILTER (WHERE "createdAt" >= ${week}) AS recent,
             count(DISTINCT "visitorId") FILTER (WHERE "createdAt" < ${week}) AS before
      FROM "PageView" WHERE "createdAt" >= ${twoWeeks}`,
    prisma.emailLog.count({ where: { ok: false, createdAt: { gte: week } } }),
    prisma.lead.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, reference: true, companyName: true, plan: true, status: true, createdAt: true, city: true, state: true },
    }),
    prisma.subscription.findMany({
      where: { status: "ACTIVE", expiresAt: { lt: in30Days } },
      orderBy: { expiresAt: "asc" },
      take: 5,
      select: { id: true, expiresAt: true, plan: true, organization: { select: { id: true, name: true } } },
    }),
    prisma.organization.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, name: true, status: true, businessType: true, createdAt: true, city: true },
    }),
  ]);

  const leads = Object.fromEntries(leadGroups.map((g) => [g.status, g._count._all])) as Record<string, number>;
  const count = (s: string) => leads[s] ?? 0;
  const openLeads = count("NEW") + count("CONTACTED") + count("INVOICED") + count("CLAIMED") + count("PAID");

  // Money by month, last 12 months, Lagos time.
  const months: { key: string; label: string; kobo: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 15);
    months.push({
      key: monthKey(d),
      label: new Intl.DateTimeFormat("en-NG", { month: "short", timeZone: TZ }).format(d),
      kobo: 0,
    });
  }
  for (const p of payments) {
    if (!p.paidAt) continue;
    const m = months.find((x) => x.key === monthKey(p.paidAt!));
    if (m) m.kobo += p.amountPaidKobo;
  }
  const thisMonthKobo = months[11].kobo;
  const lastMonthKobo = months[10].kobo;
  const yearKobo = months.reduce((t, m) => t + m.kobo, 0);
  const peak = Math.max(1, ...months.map((m) => m.kobo));

  const visitorsNow = Number(visitors[0]?.recent ?? 0);
  const visitorsBefore = Number(visitors[0]?.before ?? 0);

  const planTotal = activePlans.reduce((t, p) => t + p._count._all, 0);

  // What needs the operator, most urgent first. Only the ones with something in them show.
  const actions = [
    {
      n: count("CLAIMED"),
      title: "say they've paid",
      body: "Check your bank, then confirm.",
      href: "/platform/leads?status=CLAIMED",
      icon: BadgeCheck,
      tone: "bg-brand-50 text-brand-700 ring-brand-100",
    },
    {
      n: count("PAID"),
      title: "paid, account not created",
      body: "Create their business so they can start.",
      href: "/platform/leads?status=PAID",
      icon: Building2,
      tone: "bg-good-50 text-good-700 ring-good-100",
    },
    {
      n: count("NEW"),
      title: "new plan request" + (count("NEW") === 1 ? "" : "s"),
      body: "Payment details were emailed. Follow up if quiet.",
      href: "/platform/leads?status=NEW",
      icon: Inbox,
      tone: "bg-navy-50 text-navy-700 ring-navy-100",
    },
    {
      n: expiringSoon,
      title: "renewal" + (expiringSoon === 1 ? "" : "s") + " due in 30 days",
      body: "Remind them before they are cut off.",
      href: "/platform/subscriptions",
      icon: CalendarClock,
      tone: "bg-warn-50 text-warn-700 ring-warn-100",
    },
    {
      n: failedEmails,
      title: "email" + (failedEmails === 1 ? "" : "s") + " failed this week",
      body: "Customers may be missing messages.",
      href: "/platform/email",
      icon: MailWarning,
      tone: "bg-bad-50 text-bad-700 ring-bad-100",
    },
  ].filter((a) => a.n > 0);

  const funnel = [
    { label: "Asked for a plan", n: openLeads + count("PROVISIONED") + count("REJECTED") },
    { label: "Sent payment details", n: count("INVOICED") + count("CLAIMED") + count("PAID") + count("PROVISIONED") },
    { label: "Said they paid", n: count("CLAIMED") + count("PAID") + count("PROVISIONED") },
    { label: "Payment confirmed", n: count("PAID") + count("PROVISIONED") },
    { label: "Live on Coderswurld", n: count("PROVISIONED") },
  ];
  const funnelTop = Math.max(1, funnel[0].n);

  const revenueChange = change(thisMonthKobo, lastMonthKobo);
  const visitorsChange = change(visitorsNow, visitorsBefore);

  return (
    <div className="space-y-6">
      {/* ── Greeting ────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-ink-500">
            {new Intl.DateTimeFormat("en-NG", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(now)}
          </p>
          <h1 className="mt-0.5 text-2xl font-extrabold tracking-tight text-ink-950 sm:text-3xl">{greeting(now)}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/platform/leads" className="btn btn-outline">
            <Inbox className="size-4" />
            Plan requests
          </Link>
          <Link href="/platform/organizations/new" className="btn btn-primary">
            <Plus className="size-4" />
            Add a business
          </Link>
        </div>
      </div>

      {/* ── Needs you ───────────────────────────────────────────────────── */}
      <section aria-labelledby="needs-you">
        <h2 id="needs-you" className="sr-only">
          Needs you
        </h2>
        {actions.length === 0 ? (
          <div className="texture-waves flex items-center gap-4 rounded-3xl bg-navy-800 px-6 py-5 text-white">
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-white/10">
              <Sparkles className="size-5 text-brand-400" />
            </span>
            <div>
              <p className="text-lg font-bold">You&apos;re all caught up</p>
              <p className="text-sm text-white/70">Nothing is waiting on you. New requests and payments will show here.</p>
            </div>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {actions.map((a) => (
              <Link
                key={a.href}
                href={a.href}
                className="group card flex items-center gap-4 rounded-2xl p-4 transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-raised)]"
              >
                <span className={`grid size-12 shrink-0 place-items-center rounded-2xl ring-1 ${a.tone}`}>
                  <a.icon className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-ink-950">
                    <span className="tabular text-lg">{a.n}</span> {a.title}
                  </p>
                  <p className="text-sm text-ink-500">{a.body}</p>
                </div>
                <ArrowRight className="size-4 shrink-0 text-ink-300 transition-transform group-hover:translate-x-0.5 group-hover:text-ink-600" />
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* ── This month ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Kpi
          icon={CircleDollarSign}
          iconTone="bg-brand-600"
          label="Collected this month"
          value={formatNairaCompact(thisMonthKobo)}
          delta={revenueChange}
          note={lastMonthKobo > 0 ? `vs ${formatNairaCompact(lastMonthKobo)} last month` : "First payments this month"}
          href="/platform/subscriptions"
        />
        <Kpi
          icon={Building2}
          iconTone="bg-navy-700"
          label="Active businesses"
          value={activeOrgs}
          note={`${newOrgs} new this month${notTrading ? ` · ${notTrading} not trading` : ""}`}
          href="/platform/organizations"
        />
        <Kpi
          icon={Inbox}
          iconTone="bg-navy-500"
          label="Open requests"
          value={openLeads}
          note={openLeads ? "Waiting on a reply or payment" : "Nothing waiting"}
          href="/platform/leads"
        />
        <Kpi
          icon={Eye}
          iconTone="bg-good-700"
          label="Visitors, last 7 days"
          value={visitorsNow}
          delta={visitorsChange}
          note={visitorsBefore ? `vs ${visitorsBefore} the week before` : "Site traffic"}
          href="/platform/traffic"
        />
      </div>

      {/* ── Money and pipeline ──────────────────────────────────────────── */}
      <div className="grid gap-4 xl:grid-cols-3">
        <section className="card rounded-3xl p-5 xl:col-span-2">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-ink-500">Money collected, last 12 months</h2>
              <p className="tabular mt-0.5 text-3xl font-extrabold tracking-tight text-ink-950">{formatNaira(yearKobo)}</p>
            </div>
            <p className="text-xs text-ink-400">Confirmed subscription payments, Lagos time</p>
          </div>
          <div className="mt-6 flex h-48 items-stretch gap-1.5 sm:gap-2">
            {months.map((m) => {
              const pct = (m.kobo / peak) * 100;
              const current = m.key === thisMonth;
              return (
                <div key={m.key} className="group flex flex-1 flex-col justify-end" title={`${m.label}: ${formatNaira(m.kobo)}`}>
                  <span className="mb-1 hidden text-center text-[10px] font-semibold text-ink-500 group-hover:block">
                    {formatNairaCompact(m.kobo)}
                  </span>
                  <div
                    className={`w-full rounded-t-lg transition-colors ${
                      current ? "bg-brand-500" : m.kobo > 0 ? "bg-navy-600 group-hover:bg-navy-700" : "bg-ink-100"
                    }`}
                    style={{ height: `${Math.max(m.kobo > 0 ? 4 : 2, pct)}%` }}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex gap-1.5 sm:gap-2">
            {months.map((m) => (
              <span key={m.key} className={`flex-1 text-center text-[11px] ${m.key === thisMonth ? "font-bold text-brand-700" : "text-ink-400"}`}>
                {m.label}
              </span>
            ))}
          </div>
        </section>

        <section className="card rounded-3xl p-5">
          <h2 className="text-sm font-semibold text-ink-500">From request to live</h2>
          <ol className="mt-4 space-y-3">
            {funnel.map((f, i) => (
              <li key={f.label}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="text-ink-700">{f.label}</span>
                  <span className="tabular font-bold text-ink-950">{f.n}</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-ink-100">
                  <div
                    className={`h-full rounded-full ${i === funnel.length - 1 ? "bg-good-700" : "bg-navy-600"}`}
                    style={{ width: `${Math.round((f.n / funnelTop) * 100)}%`, opacity: 1 - i * 0.12 }}
                  />
                </div>
              </li>
            ))}
          </ol>

          <h2 className="mt-6 text-sm font-semibold text-ink-500">Plans in use</h2>
          {planTotal === 0 ? (
            <p className="mt-2 text-sm text-ink-400">No active subscriptions yet.</p>
          ) : (
            <>
              <div className="mt-3 flex h-3 overflow-hidden rounded-full">
                {activePlans.map((p, i) => (
                  <div
                    key={p.plan}
                    className={["bg-navy-600", "bg-brand-500", "bg-good-700"][i % 3]}
                    style={{ width: `${(p._count._all / planTotal) * 100}%` }}
                  />
                ))}
              </div>
              <ul className="mt-3 space-y-1.5 text-sm">
                {activePlans.map((p, i) => (
                  <li key={p.plan} className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-ink-700">
                      <span className={`size-2.5 rounded-full ${["bg-navy-600", "bg-brand-500", "bg-good-700"][i % 3]}`} />
                      {PLANS[p.plan as PlanId]?.name ?? p.plan}
                    </span>
                    <span className="tabular font-semibold text-ink-950">{p._count._all}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>

      {/* ── Latest ──────────────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-3">
        <ListCard title="Latest requests" href="/platform/leads" empty="No plan requests yet.">
          {recentLeads.map((l) => (
            <Row
              key={l.id}
              href={`/platform/leads/${l.id}`}
              initials={l.companyName}
              title={l.companyName}
              sub={`${PLANS[l.plan as PlanId]?.name ?? l.plan} · ${[l.city, l.state].filter(Boolean).join(", ")}`}
              right={<LeadStatusBadge status={l.status} />}
              meta={relativeDays(l.createdAt, now)}
            />
          ))}
        </ListCard>

        <ListCard title="Renewals due" href="/platform/subscriptions" empty="No subscription ends in the next 30 days.">
          {lapsing.map((s) => {
            const days = Math.ceil((s.expiresAt.getTime() - now.getTime()) / day);
            return (
              <Row
                key={s.id}
                href={`/platform/organizations/${s.organization.id}`}
                initials={s.organization.name}
                title={s.organization.name}
                sub={`${PLANS[s.plan as PlanId]?.name ?? s.plan} · ends ${formatDate(s.expiresAt)}`}
                right={
                  <span className={`badge ${days <= 7 ? "badge-bad" : "badge-warn"}`}>
                    {days <= 0 ? "Ended" : `${days} day${days === 1 ? "" : "s"}`}
                  </span>
                }
              />
            );
          })}
        </ListCard>

        <ListCard title="Newest businesses" href="/platform/organizations" empty="No businesses yet.">
          {newestOrgs.map((o) => (
            <Row
              key={o.id}
              href={`/platform/organizations/${o.id}`}
              initials={o.name}
              title={o.name}
              sub={[o.businessType === "PHARMACY" ? "Pharmacy" : "Supermarket", o.city].filter(Boolean).join(" · ")}
              right={<OrgStatusBadge status={o.status} />}
              meta={`joined ${relativeDays(o.createdAt, now)}`}
            />
          ))}
        </ListCard>
      </div>
    </div>
  );
}

function Kpi({
  icon: Icon,
  iconTone,
  label,
  value,
  note,
  delta,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>;
  iconTone: string;
  label: string;
  value: string | number;
  note: string;
  delta?: number | null;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group card flex flex-col rounded-3xl p-4 transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-raised)] sm:p-5"
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`texture-waves grid size-10 place-items-center rounded-xl text-white ${iconTone}`}>
          <Icon className="size-5" />
        </span>
        {delta !== undefined && delta !== null ? (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${
              delta >= 0 ? "bg-good-50 text-good-700" : "bg-bad-50 text-bad-700"
            }`}
          >
            {delta >= 0 ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
            {delta >= 0 ? "+" : ""}
            {delta}%
          </span>
        ) : (
          <ArrowUpRight className="size-4 text-ink-300 transition-colors group-hover:text-ink-600" />
        )}
      </div>
      <p className="mt-4 text-xs font-bold uppercase leading-tight tracking-wider text-ink-500">{label}</p>
      <p className="tabular mt-1 text-2xl font-extrabold tracking-tight text-ink-950 sm:text-3xl">
        {typeof value === "number" ? <CountUp value={value} /> : value}
      </p>
      <p className="mt-0.5 text-xs text-ink-500 sm:text-sm">{note}</p>
    </Link>
  );
}

function ListCard({
  title,
  href,
  empty,
  children,
}: {
  title: string;
  href: string;
  empty: string;
  children: React.ReactNode[];
}) {
  return (
    <section className="card flex flex-col overflow-hidden rounded-3xl">
      <div className="flex items-center justify-between border-b border-hairline px-5 py-3.5">
        <h2 className="font-bold text-ink-950">{title}</h2>
        <Link href={href} className="inline-flex items-center gap-1 text-sm font-semibold text-navy-700 hover:underline">
          See all <ArrowRight className="size-3.5" />
        </Link>
      </div>
      {children.length === 0 ? (
        <p className="flex flex-1 items-center justify-center px-5 py-10 text-center text-sm text-ink-400">{empty}</p>
      ) : (
        <ul className="divide-y divide-hairline">{children}</ul>
      )}
    </section>
  );
}

function Row({
  href,
  initials,
  title,
  sub,
  right,
  meta,
}: {
  href: string;
  initials: string;
  title: string;
  sub: string;
  right: React.ReactNode;
  meta?: string;
}) {
  const letters = initials
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (
    <li>
      <Link href={href} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-ink-50">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-navy-50 text-xs font-bold text-navy-700">
          {letters}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink-950">{title}</span>
          <span className="block truncate text-xs text-ink-500">{sub}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          {right}
          {meta ? <span className="text-[11px] text-ink-400">{meta}</span> : null}
        </span>
      </Link>
    </li>
  );
}
