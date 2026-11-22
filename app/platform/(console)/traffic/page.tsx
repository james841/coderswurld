import { ConsoleHeading } from "../../ConsoleHeading";
import Link from "next/link";
import { Prisma } from "@prisma/client";
import { Activity, Clock, Eye, Inbox, MousePointerClick, Users, BarChart3 } from "lucide-react";

import { CountUp } from "@/components/motion";
import { prisma } from "@/lib/db";
import { CHANNEL_LABELS, countryFlag, countryName, type Channel } from "@/lib/traffic";

/**
 * Site traffic: who visits the public site, where they come from, what they
 * use, and how many of them ask for a plan. Built from our own PageView rows,
 * so it needs no outside analytics account.
 */

export const dynamic = "force-dynamic";

const RANGES = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
] as const;

const TZ = "Africa/Lagos";

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);

function fmtDuration(ms: number) {
  if (!ms) return "0s";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

function pct(part: number, whole: number) {
  return whole ? Math.round((part / whole) * 1000) / 10 : 0;
}

function change(now: number, before: number) {
  if (!before) return now ? null : 0;
  return Math.round(((now - before) / before) * 100);
}

export default async function TrafficPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const days = RANGES.find((r) => String(r.days) === sp.days)?.days ?? 30;
  const now = new Date();
  const from = new Date(now.getTime() - days * 86_400_000);
  const prevFrom = new Date(from.getTime() - days * 86_400_000);
  const live = new Date(now.getTime() - 5 * 60_000);
  const local = Prisma.sql`(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${TZ})`;

  const [
    [totals],
    [prev],
    [bounce],
    daily,
    channels,
    sources,
    countries,
    devices,
    browsers,
    systems,
    pages,
    campaigns,
    hours,
    [liveNow],
    leads,
    prevLeads,
    leadSources,
    recent,
  ] = await Promise.all([
    prisma.$queryRaw<Row[]>`
      SELECT COUNT(*) AS views,
             COUNT(DISTINCT "visitorId") AS visitors,
             COUNT(DISTINCT "sessionId") AS sessions,
             COUNT(DISTINCT CASE WHEN "isNewVisitor" THEN "visitorId" END) AS "newVisitors",
             AVG("durationMs") AS "avgMs",
             AVG("scrollDepth") AS "avgScroll"
      FROM "PageView" WHERE "createdAt" >= ${from}`,
    prisma.$queryRaw<Row[]>`
      SELECT COUNT(*) AS views, COUNT(DISTINCT "visitorId") AS visitors
      FROM "PageView" WHERE "createdAt" >= ${prevFrom} AND "createdAt" < ${from}`,
    prisma.$queryRaw<Row[]>`
      SELECT COUNT(*) FILTER (WHERE c = 1) AS single, COUNT(*) AS total
      FROM (SELECT COUNT(*) AS c FROM "PageView" WHERE "createdAt" >= ${from} GROUP BY "sessionId") s`,
    prisma.$queryRaw<Row[]>`
      SELECT to_char(${local}::date, 'YYYY-MM-DD') AS day,
             COUNT(*) AS views, COUNT(DISTINCT "visitorId") AS visitors
      FROM "PageView" WHERE "createdAt" >= ${from} GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<Row[]>`
      SELECT channel AS key, COUNT(DISTINCT "visitorId") AS visitors
      FROM "PageView" WHERE "createdAt" >= ${from} GROUP BY 1 ORDER BY 2 DESC`,
    prisma.$queryRaw<Row[]>`
      SELECT source AS key, MIN(channel) AS channel, COUNT(DISTINCT "visitorId") AS visitors, COUNT(*) AS views
      FROM "PageView" WHERE "createdAt" >= ${from} GROUP BY 1 ORDER BY 3 DESC LIMIT 10`,
    prisma.$queryRaw<Row[]>`
      SELECT country AS key, COUNT(DISTINCT "visitorId") AS visitors
      FROM "PageView" WHERE "createdAt" >= ${from} GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
    prisma.$queryRaw<Row[]>`
      SELECT device AS key, COUNT(DISTINCT "visitorId") AS visitors
      FROM "PageView" WHERE "createdAt" >= ${from} GROUP BY 1 ORDER BY 2 DESC`,
    prisma.$queryRaw<Row[]>`
      SELECT COALESCE(browser, 'Other') AS key, COUNT(DISTINCT "visitorId") AS visitors
      FROM "PageView" WHERE "createdAt" >= ${from} GROUP BY 1 ORDER BY 2 DESC LIMIT 6`,
    prisma.$queryRaw<Row[]>`
      SELECT COALESCE(os, 'Other') AS key, COUNT(DISTINCT "visitorId") AS visitors
      FROM "PageView" WHERE "createdAt" >= ${from} GROUP BY 1 ORDER BY 2 DESC LIMIT 6`,
    prisma.$queryRaw<Row[]>`
      SELECT path AS key, COUNT(*) AS views, AVG("durationMs") AS "avgMs", AVG("scrollDepth") AS scroll
      FROM "PageView" WHERE "createdAt" >= ${from} GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
    prisma.$queryRaw<Row[]>`
      SELECT "utmCampaign" AS key, MIN("utmSource") AS src, COUNT(DISTINCT "visitorId") AS visitors
      FROM "PageView" WHERE "createdAt" >= ${from} AND "utmCampaign" IS NOT NULL
      GROUP BY 1 ORDER BY 3 DESC LIMIT 8`,
    prisma.$queryRaw<Row[]>`
      SELECT EXTRACT(HOUR FROM ${local})::int AS hour, COUNT(DISTINCT "visitorId") AS visitors
      FROM "PageView" WHERE "createdAt" >= ${from} GROUP BY 1`,
    prisma.$queryRaw<Row[]>`
      SELECT COUNT(DISTINCT "visitorId") AS visitors FROM "PageView" WHERE "createdAt" >= ${live}`,
    prisma.lead.count({ where: { createdAt: { gte: from } } }),
    prisma.lead.count({ where: { createdAt: { gte: prevFrom, lt: from } } }),
    prisma.lead.groupBy({
      by: ["trafficSource"],
      where: { createdAt: { gte: from } },
      _count: { _all: true },
      orderBy: { _count: { trafficSource: "desc" } },
      take: 8,
    }),
    prisma.pageView.findMany({
      orderBy: { createdAt: "desc" },
      take: 12,
      select: { id: true, path: true, source: true, country: true, device: true, browser: true, createdAt: true, durationMs: true },
    }),
  ]);

  const visitors = n(totals.visitors);
  const views = n(totals.views);
  const sessions = n(totals.sessions);

  // Fill every day of the range so quiet days show as gaps, not missing bars.
  const byDay = new Map(daily.map((d) => [String(d.day), d]));
  const series: { day: string; visitors: number; views: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = new Date(now.getTime() - i * 86_400_000).toLocaleDateString("en-CA", { timeZone: TZ });
    const row = byDay.get(key);
    series.push({ day: key, visitors: n(row?.visitors), views: n(row?.views) });
  }
  const peak = Math.max(1, ...series.map((d) => d.visitors));

  const hourMap = new Map(hours.map((h) => [n(h.hour), n(h.visitors)]));
  const hourPeak = Math.max(1, ...hourMap.values());

  const stats = [
    { label: "Visitors", value: visitors, icon: Users, tone: "bg-navy-700", delta: change(visitors, n(prev.visitors)), caption: `${n(totals.newVisitors)} new` },
    { label: "Page views", value: views, icon: Eye, tone: "bg-brand-700", delta: change(views, n(prev.views)), caption: `${sessions} visits` },
    { label: "Time on page", text: fmtDuration(n(totals.avgMs)), icon: Clock, tone: "bg-good-700", caption: `Scroll ${Math.round(n(totals.avgScroll))}% down on average` },
    { label: "Left after one page", text: `${pct(n(bounce.single), n(bounce.total))}%`, icon: MousePointerClick, tone: "bg-ink-700", caption: "Lower is better" },
    { label: "Plan requests", value: leads, icon: Inbox, tone: "bg-sell-600", delta: change(leads, prevLeads), caption: `${pct(leads, visitors)}% of visitors asked` },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <ConsoleHeading icon={BarChart3} title="Site traffic">
          Who visits the website, where they come from, and how many ask for a plan.
        </ConsoleHeading>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-2 rounded-full bg-good-50 px-3 py-1.5 text-sm font-semibold text-good-700">
            <span className="relative flex size-2">
              {n(liveNow.visitors) > 0 ? (
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-good-500 opacity-60" />
              ) : null}
              <span className="relative inline-flex size-2 rounded-full bg-good-700" />
            </span>
            {n(liveNow.visitors)} on the site now
          </span>
          <nav className="flex rounded-full bg-white p-1 shadow-sm ring-1 ring-hairline">
            {RANGES.map((r) => (
              <Link
                key={r.days}
                href={`/platform/traffic?days=${r.days}`}
                className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
                  r.days === days ? "bg-navy-700 text-white" : "text-ink-600 hover:text-ink-950"
                }`}
              >
                {r.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        {stats.map((s) => (
          <div key={s.label} className="card card-pad rounded-3xl">
            <span className={`texture-waves grid size-10 place-items-center rounded-2xl text-white ${s.tone}`}>
              <s.icon className="size-5" />
            </span>
            <p className="mt-4 text-xs font-bold uppercase tracking-wider text-ink-500">{s.label}</p>
            <div className="mt-1 flex items-baseline gap-2">
              <p className="tabular text-2xl font-bold tracking-tight text-ink-950 sm:text-3xl">
                {"value" in s && s.value !== undefined ? <CountUp value={s.value} /> : s.text}
              </p>
              {"delta" in s && s.delta !== undefined ? <Delta value={s.delta} /> : null}
            </div>
            <p className="mt-0.5 text-sm text-ink-500">{s.caption}</p>
          </div>
        ))}
      </div>

      <section className="card rounded-3xl p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-bold text-ink-950">Visitors per day</h2>
          <p className="text-xs text-ink-500">Lagos time. Hover a bar for the numbers.</p>
        </div>
        {visitors === 0 ? (
          <Empty text="No visits recorded in this period yet." />
        ) : (
          <div className="mt-4 flex h-48 items-end gap-[3px]">
            {series.map((d) => (
              <div key={d.day} className="group relative flex h-full flex-1 flex-col justify-end" title={`${dayLabel(d.day)}: ${d.visitors} visitors, ${d.views} views`}>
                <div
                  className="rounded-t-md bg-navy-600 transition-colors group-hover:bg-brand-600"
                  style={{ height: `${Math.max(d.visitors ? 4 : 1, (d.visitors / peak) * 100)}%`, opacity: d.visitors ? 1 : 0.25 }}
                />
              </div>
            ))}
          </div>
        )}
        <div className="mt-2 flex justify-between text-[0.6875rem] text-ink-400">
          <span>{series[0] ? dayLabel(series[0].day) : null}</span>
          <span>{series.length ? dayLabel(series[series.length - 1].day) : null}</span>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="How people find us" note="Visitors by channel">
          <BarList
            total={visitors}
            rows={channels.map((c) => ({ label: CHANNEL_LABELS[String(c.key) as Channel] ?? String(c.key), value: n(c.visitors) }))}
          />
        </Panel>
        <Panel title="Top sources" note="Visitors">
          <BarList
            total={visitors}
            rows={sources.map((s) => ({
              label: String(s.key),
              hint: CHANNEL_LABELS[String(s.channel) as Channel],
              value: n(s.visitors),
            }))}
          />
        </Panel>
        <Panel title="Where they are" note="Visitors by country">
          <BarList
            total={visitors}
            rows={countries.map((c) => ({
              label: `${countryFlag(c.key ? String(c.key) : null)}  ${countryName(c.key ? String(c.key) : null)}`,
              value: n(c.visitors),
            }))}
          />
        </Panel>
        <Panel title="Plan requests by source" note="Where paying interest comes from">
          <BarList
            total={leads}
            tone="bg-sell-100"
            rows={leadSources.map((l) => ({ label: l.trafficSource ?? "Not tracked", value: l._count._all }))}
            empty="No plan requests in this period."
          />
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Devices">
          <BarList total={visitors} tone="bg-brand-100" rows={devices.map((d) => ({ label: cap(String(d.key)), value: n(d.visitors) }))} />
        </Panel>
        <Panel title="Browsers">
          <BarList total={visitors} tone="bg-brand-100" rows={browsers.map((d) => ({ label: String(d.key), value: n(d.visitors) }))} />
        </Panel>
        <Panel title="Phone and computer systems">
          <BarList total={visitors} tone="bg-brand-100" rows={systems.map((d) => ({ label: String(d.key), value: n(d.visitors) }))} />
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Pages" note="Views, time spent and how far people scroll">
          {pages.length === 0 ? (
            <Empty text="No pages viewed yet." />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-ink-500">
                  <th className="pb-2 font-semibold">Page</th>
                  <th className="pb-2 text-right font-semibold">Views</th>
                  <th className="pb-2 text-right font-semibold">Time</th>
                  <th className="pb-2 text-right font-semibold">Scroll</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {pages.map((p) => (
                  <tr key={String(p.key)}>
                    <td className="py-2 font-mono text-xs text-ink-800">{String(p.key) === "/" ? "/ (home)" : String(p.key)}</td>
                    <td className="tabular py-2 text-right font-semibold">{n(p.views)}</td>
                    <td className="tabular py-2 text-right text-ink-600">{fmtDuration(n(p.avgMs))}</td>
                    <td className="tabular py-2 text-right text-ink-600">{Math.round(n(p.scroll))}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
        <Panel title="Busiest hours" note="Visitors by hour, Lagos time">
          <div className="flex h-36 items-end gap-1">
            {Array.from({ length: 24 }, (_, h) => {
              const v = hourMap.get(h) ?? 0;
              return (
                <div key={h} className="flex h-full flex-1 flex-col justify-end" title={`${h}:00 - ${v} visitors`}>
                  <div className="rounded-t bg-navy-500" style={{ height: `${Math.max(2, (v / hourPeak) * 100)}%`, opacity: v ? 1 : 0.2 }} />
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex justify-between text-[0.6875rem] text-ink-400">
            <span>12am</span>
            <span>6am</span>
            <span>12pm</span>
            <span>6pm</span>
            <span>11pm</span>
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Campaigns" note="Links tagged with utm_campaign">
          {campaigns.length === 0 ? (
            <Empty text="No campaign links used yet. Add ?utm_source=instagram&utm_campaign=promo to a link you share to see it here." />
          ) : (
            <BarList total={visitors} rows={campaigns.map((c) => ({ label: String(c.key), hint: c.src ? String(c.src) : undefined, value: n(c.visitors) }))} />
          )}
        </Panel>
        <Panel title="Latest visits">
          {recent.length === 0 ? (
            <Empty text="Nobody has visited yet." />
          ) : (
            <ul className="divide-y divide-hairline">
              {recent.map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-2 text-sm">
                  <span className="text-lg leading-none">{countryFlag(r.country)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-ink-900">
                      {r.source} <span className="font-normal text-ink-500">to</span> <span className="font-mono text-xs">{r.path}</span>
                    </p>
                    <p className="text-xs text-ink-500">
                      {cap(r.device)}
                      {r.browser ? `, ${r.browser}` : ""}
                      {r.durationMs ? `, stayed ${fmtDuration(r.durationMs)}` : ""}
                    </p>
                  </div>
                  <time className="shrink-0 text-xs text-ink-400">
                    {r.createdAt.toLocaleString("en-NG", { timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <p className="flex items-start gap-2 text-xs text-ink-500">
        <Activity className="mt-0.5 size-3.5 shrink-0" />
        Counts the landing page and the sign-in page. Bots and visitors with Do Not Track switched on are left out.
        No cookies or IP addresses are stored. Country comes from your host when it supplies one, otherwise from the
        visitor&apos;s time zone.
      </p>
    </div>
  );
}

function cap(s: string) {
  return s.charAt(0) + s.slice(1).toLowerCase();
}

function Delta({ value }: { value: number | null }) {
  if (value === null) return <span className="text-xs font-semibold text-good-700">new</span>;
  if (value === 0) return <span className="text-xs font-semibold text-ink-400">0%</span>;
  return (
    <span className={`text-xs font-semibold ${value > 0 ? "text-good-700" : "text-sell-600"}`}>
      {value > 0 ? "▲" : "▼"} {Math.abs(value)}%
    </span>
  );
}

function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="card rounded-3xl p-5">
      <div className="mb-4 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold text-ink-950">{title}</h2>
        {note ? <p className="text-xs text-ink-500">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

function BarList({
  rows,
  total,
  tone = "bg-navy-100",
  empty = "Nothing yet.",
}: {
  rows: { label: string; hint?: string; value: number }[];
  total: number;
  tone?: string;
  empty?: string;
}) {
  if (rows.length === 0) return <Empty text={empty} />;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.label} className="relative flex items-center justify-between gap-3 overflow-hidden rounded-lg px-3 py-2 text-sm">
          <span className={`absolute inset-y-0 left-0 rounded-lg ${tone} opacity-60`} style={{ width: `${(r.value / max) * 100}%` }} />
          <span className="relative min-w-0 truncate font-semibold text-ink-900">
            {r.label}
            {r.hint ? <span className="ml-1.5 text-xs font-normal text-ink-500">{r.hint}</span> : null}
          </span>
          <span className="tabular relative shrink-0 text-ink-700">
            <span className="font-bold">{r.value}</span>
            <span className="ml-1.5 text-xs text-ink-500">{pct(r.value, total)}%</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="py-8 text-center text-sm text-ink-500">{text}</p>;
}

/** "2026-10-22" to "22 Oct". The day key is already in Lagos time. */
function dayLabel(day: string): string {
  const [y, mo, d] = day.split("-").map(Number);
  if (!y || !mo || !d) return day;
  return new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, mo - 1, d)),
  );
}
