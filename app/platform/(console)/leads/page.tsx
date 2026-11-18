import type { Metadata } from "next";
import Link from "next/link";
import { Inbox, Search } from "lucide-react";
import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { formatDate, relativeDays } from "@/lib/dates";
import { formatNaira } from "@/lib/money";
import { LeadStatusBadge, PlanBadge } from "../../StatusBadges";

export const metadata: Metadata = { title: "Requests" };

const TABS = [
  { key: "OPEN", label: "Open" },
  { key: "NEW", label: "New" },
  { key: "CONTACTED", label: "Contacted" },
  { key: "INVOICED", label: "Invoiced" },
  { key: "PAID", label: "Paid" },
  { key: "PROVISIONED", label: "Live" },
  { key: "REJECTED", label: "Rejected" },
  { key: "ALL", label: "All" },
] as const;

const PAGE_SIZE = 40;

/**
 * The request pipeline.
 *
 * Defaults to "Open" rather than "All" on purpose: the operator opens this
 * screen to find out what needs doing, and a list that starts with two hundred
 * closed-won rows from last year buries that.
 */
export default async function LeadsPage({ searchParams }: PageProps<"/platform/leads">) {
  const params = await searchParams;
  const tab = typeof params.status === "string" ? params.status : "OPEN";
  const query = typeof params.q === "string" ? params.q.trim() : "";
  const page = Math.max(1, Number(params.page) || 1);

  const where: Prisma.LeadWhereInput = {};
  if (tab === "OPEN") {
    where.status = { in: ["NEW", "CONTACTED", "INVOICED", "PAID"] };
  } else if (tab !== "ALL") {
    where.status = tab;
  }
  if (query) {
    where.OR = [
      { companyName: { contains: query, mode: "insensitive" } },
      { contactName: { contains: query, mode: "insensitive" } },
      { email: { contains: query, mode: "insensitive" } },
      { phone: { contains: query } },
      { reference: { contains: query, mode: "insensitive" } },
    ];
  }

  const [leads, total, counts] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        reference: true,
        companyName: true,
        contactName: true,
        email: true,
        phone: true,
        city: true,
        state: true,
        plan: true,
        quotedKobo: true,
        status: true,
        createdAt: true,
        branchCount: true,
        staffCount: true,
      },
    }),
    prisma.lead.count({ where }),
    prisma.lead.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);

  const countByStatus = new Map(counts.map((c) => [c.status, c._count._all]));
  const openCount =
    (countByStatus.get("NEW") ?? 0) +
    (countByStatus.get("CONTACTED") ?? 0) +
    (countByStatus.get("INVOICED") ?? 0) +
    (countByStatus.get("PAID") ?? 0);
  const totalAll = counts.reduce((sum, c) => sum + c._count._all, 0);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const now = new Date();

  function tabHref(key: string) {
    const next = new URLSearchParams();
    if (key !== "OPEN") next.set("status", key);
    if (query) next.set("q", query);
    const search = next.toString();
    return search ? `/platform/leads?${search}` : "/platform/leads";
  }

  function tabCount(key: string) {
    if (key === "OPEN") return openCount;
    if (key === "ALL") return totalAll;
    return countByStatus.get(key) ?? 0;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-950">Requests</h1>
          <p className="mt-0.5 text-sm text-ink-600">
            Plan requests from the landing page. Invoice them, then provision.
          </p>
        </div>

        <form action="/platform/leads" className="flex items-center gap-2">
          {tab !== "OPEN" ? <input type="hidden" name="status" value={tab} /> : null}
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
            <input
              name="q"
              type="search"
              defaultValue={query}
              placeholder="Name, email, CW-0001…"
              className="input w-60 pl-8"
            />
          </div>
          <button type="submit" className="btn btn-outline">
            Search
          </button>
        </form>
      </div>

      {/* ── Status tabs ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1.5">
        {TABS.map(({ key, label }) => {
          const active = tab === key;
          const count = tabCount(key);
          return (
            <Link
              key={key}
              href={tabHref(key)}
              aria-current={active ? "page" : undefined}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-semibold transition-colors ${
                active
                  ? "border-navy-700 bg-navy-700 text-white"
                  : "border-ink-200 bg-white text-ink-700 hover:border-ink-300 hover:bg-ink-50"
              }`}
            >
              {label}
              <span
                className={`tabular rounded px-1 text-[0.6875rem] ${
                  active ? "bg-white/20 text-white" : "bg-ink-100 text-ink-600"
                }`}
              >
                {count}
              </span>
            </Link>
          );
        })}
      </div>

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      <div className="card overflow-hidden">
        {leads.length === 0 ? (
          <div className="px-4 py-16 text-center">
            <span className="mx-auto mb-3 grid size-11 place-items-center rounded-full bg-ink-50 text-ink-400">
              <Inbox className="size-5" />
            </span>
            <p className="text-sm font-semibold text-ink-800">
              {query ? "Nothing matched that search" : "No requests here"}
            </p>
            <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-ink-500">
              {query
                ? "Try a company name, an email address, or a CW- reference."
                : "When a business picks a plan on the landing page, it appears here."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Business</th>
                  <th>Contact</th>
                  <th>Plan</th>
                  <th data-numeric>Quoted</th>
                  <th>Status</th>
                  <th>Received</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr key={lead.id} className="cursor-pointer">
                    <td>
                      <Link href={`/platform/leads/${lead.id}`} className="block">
                        <span className="block font-semibold text-ink-950">
                          {lead.companyName}
                        </span>
                        <span className="mt-0.5 block text-xs text-ink-500">
                          <span className="font-mono">{lead.reference}</span>
                          {lead.city || lead.state
                            ? ` · ${[lead.city, lead.state].filter(Boolean).join(", ")}`
                            : ""}
                          {` · ${lead.branchCount} shop${lead.branchCount === 1 ? "" : "s"}, ${lead.staffCount} staff`}
                        </span>
                      </Link>
                    </td>
                    <td>
                      <Link href={`/platform/leads/${lead.id}`} className="block">
                        <span className="block text-ink-800">{lead.contactName}</span>
                        <span className="mt-0.5 block text-xs text-ink-500">
                          {lead.email}
                        </span>
                      </Link>
                    </td>
                    <td>
                      <Link href={`/platform/leads/${lead.id}`} className="block">
                        <PlanBadge plan={lead.plan} />
                      </Link>
                    </td>
                    <td data-numeric className="text-right font-semibold text-ink-900">
                      <Link href={`/platform/leads/${lead.id}`} className="block">
                        {formatNaira(lead.quotedKobo)}
                      </Link>
                    </td>
                    <td>
                      <Link href={`/platform/leads/${lead.id}`} className="block">
                        <LeadStatusBadge status={lead.status} />
                      </Link>
                    </td>
                    <td className="whitespace-nowrap">
                      <Link href={`/platform/leads/${lead.id}`} className="block">
                        <span className="block text-ink-700">
                          {relativeDays(lead.createdAt, now)}
                        </span>
                        <span className="mt-0.5 block text-xs text-ink-400">
                          {formatDate(lead.createdAt)}
                        </span>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {pages > 1 ? (
        <nav className="flex items-center justify-between text-sm">
          <p className="text-ink-500">
            Page {page} of {pages} · {total} request{total === 1 ? "" : "s"}
          </p>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link
                href={`${tabHref(tab)}${tabHref(tab).includes("?") ? "&" : "?"}page=${page - 1}`}
                className="btn btn-outline btn-sm"
              >
                Previous
              </Link>
            ) : null}
            {page < pages ? (
              <Link
                href={`${tabHref(tab)}${tabHref(tab).includes("?") ? "&" : "?"}page=${page + 1}`}
                className="btn btn-outline btn-sm"
              >
                Next
              </Link>
            ) : null}
          </div>
        </nav>
      ) : null}
    </div>
  );
}
