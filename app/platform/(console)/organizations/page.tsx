import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  Building2,
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
  Store,
  Users,
} from "lucide-react";

import { prisma } from "@/lib/db";
import { daysBetween, formatDate } from "@/lib/dates";
import { formatNairaCompact } from "@/lib/money";
import { BUSINESS_TYPE_LABELS } from "@/lib/constants";
import { OrgStatusBadge, PlanBadge } from "../../StatusBadges";

export const metadata: Metadata = { title: "Businesses" };

/**
 * Every business on the platform.
 *
 * The default view is everyone, not just the active ones, because the operator
 * arrives here from two directions: "show me my customers" and "why can't this
 * shop sign in". Hiding suspended and expired accounts by default would answer
 * the first question and hide the answer to the second.
 *
 * Renewal urgency is the column that earns its place. Everything else on the row
 * is identity; "expires in 9 days" is the only thing that needs doing today.
 */

const PAGE_SIZE = 30;

const TABS = [
  { key: "ALL", label: "All" },
  { key: "ACTIVE", label: "Active" },
  { key: "EXPIRING", label: "Expiring" },
  { key: "PENDING", label: "Awaiting activation" },
  { key: "SUSPENDED", label: "Suspended" },
  { key: "EXPIRED", label: "Expired" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/** Inside this window a renewal is the operator's problem, not next month's. */
const EXPIRING_SOON_DAYS = 30;

export default async function OrganizationsPage({
  searchParams,
}: PageProps<"/platform/organizations">) {
  const resolved = await searchParams;
  const rawStatus = typeof resolved.status === "string" ? resolved.status : "ALL";
  const tab: TabKey = TABS.some((t) => t.key === rawStatus) ? (rawStatus as TabKey) : "ALL";
  const q = typeof resolved.q === "string" ? resolved.q.trim() : "";
  const page = Math.max(1, Number(resolved.page) || 1);

  const now = new Date();
  const soon = new Date(now);
  soon.setDate(soon.getDate() + EXPIRING_SOON_DAYS);

  const where: Record<string, unknown> = {};
  if (tab === "EXPIRING") {
    // "Expiring" cuts across status: an active account with 9 days left and a
    // suspended one with 9 days left are the same phone call.
    where.subscriptions = {
      some: { status: "ACTIVE", expiresAt: { gte: now, lte: soon } },
    };
  } else if (tab !== "ALL") {
    where.status = tab;
  }

  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { phone: { contains: q } },
      { city: { contains: q, mode: "insensitive" } },
    ];
  }

  const [organizations, total, statusCounts, expiringCount] = await Promise.all([
    prisma.organization.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        name: true,
        businessType: true,
        email: true,
        phone: true,
        city: true,
        state: true,
        plan: true,
        status: true,
        createdAt: true,
        _count: { select: { users: true, branches: true } },
        // Only the live term matters on a list row; the full payment history is
        // on the detail page.
        subscriptions: {
          where: { status: "ACTIVE" },
          orderBy: { expiresAt: "desc" },
          take: 1,
          select: { expiresAt: true, amountPaidKobo: true },
        },
      },
    }),
    prisma.organization.count({ where }),
    prisma.organization.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.organization.count({
      where: {
        subscriptions: { some: { status: "ACTIVE", expiresAt: { gte: now, lte: soon } } },
      },
    }),
  ]);

  const byStatus = new Map(statusCounts.map((row) => [row.status, row._count._all]));
  const allCount = statusCounts.reduce((sum, row) => sum + row._count._all, 0);
  const countFor = (key: TabKey) =>
    key === "ALL" ? allCount : key === "EXPIRING" ? expiringCount : (byStatus.get(key) ?? 0);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function tabHref(key: TabKey) {
    const search = new URLSearchParams();
    if (key !== "ALL") search.set("status", key);
    if (q) search.set("q", q);
    const query = search.toString();
    return query ? `/platform/organizations?${query}` : "/platform/organizations";
  }

  function pageHref(next: number) {
    const search = new URLSearchParams();
    if (tab !== "ALL") search.set("status", tab);
    if (q) search.set("q", q);
    if (next > 1) search.set("page", String(next));
    const query = search.toString();
    return query ? `/platform/organizations?${query}` : "/platform/organizations";
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-950">Businesses</h1>
          <p className="mt-0.5 text-sm text-ink-500">
            {allCount === 0
              ? "No businesses yet."
              : `${allCount.toLocaleString()} ${allCount === 1 ? "business" : "businesses"} on the platform.`}
          </p>
        </div>
        <Link href="/platform/organizations/new" className="btn btn-primary btn-sm">
          <Plus className="size-4" />
          Add a business
        </Link>
      </header>

      {/* ── Filters ───────────────────────────────────────────────────────── */}
      <div className="card">
        <div className="flex flex-wrap items-center gap-1 border-b border-hairline p-2">
          {TABS.map((item) => {
            const active = tab === item.key;
            const count = countFor(item.key);
            return (
              <Link
                key={item.key}
                href={tabHref(item.key)}
                aria-current={active ? "page" : undefined}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
                  active
                    ? "bg-navy-700 text-white"
                    : "text-ink-600 hover:bg-ink-50 hover:text-ink-900"
                }`}
              >
                {item.key === "EXPIRING" && count > 0 && !active ? (
                  <AlertTriangle className="size-3.5 text-warn-700" />
                ) : null}
                {item.label}
                <span
                  className={`tabular text-xs font-bold ${active ? "text-white/60" : "text-ink-400"}`}
                >
                  {count}
                </span>
              </Link>
            );
          })}
        </div>

        <form action="/platform/organizations" className="flex gap-2 p-3">
          {tab !== "ALL" ? <input type="hidden" name="status" value={tab} /> : null}
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Search by name, email, phone or town…"
              aria-label="Search businesses"
              className="input pl-9"
            />
          </div>
          <button type="submit" className="btn btn-dark btn-sm">
            Search
          </button>
          {q ? (
            <Link href={tabHref(tab)} className="btn btn-ghost btn-sm">
              Clear
            </Link>
          ) : null}
        </form>
      </div>

      {/* ── Results ───────────────────────────────────────────────────────── */}
      {organizations.length === 0 ? (
        <div className="card card-pad text-center">
          <div className="mx-auto mb-3 grid size-11 place-items-center rounded-full bg-ink-50">
            <Building2 className="size-5 text-ink-400" />
          </div>
          <p className="text-sm font-semibold text-ink-900">
            {q
              ? `Nothing matches “${q}”.`
              : tab === "ALL"
                ? "No businesses yet."
                : `No ${TABS.find((t) => t.key === tab)?.label.toLowerCase()} businesses.`}
          </p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-ink-500">
            {tab === "ALL" && !q
              ? "Businesses appear here once you provision them from a request."
              : "Try a different filter, or clear the search."}
          </p>
          {tab === "ALL" && !q ? (
            <Link href="/platform/leads" className="btn btn-primary btn-sm mt-4">
              Open requests
            </Link>
          ) : null}
        </div>
      ) : (
        <>
          <ul className="space-y-2">
            {organizations.map((organization) => {
              const subscription = organization.subscriptions[0];
              const daysLeft = subscription
                ? daysBetween(now, subscription.expiresAt)
                : null;
              const urgent = daysLeft !== null && daysLeft <= EXPIRING_SOON_DAYS;
              const lapsed = daysLeft !== null && daysLeft < 0;

              return (
                <li key={organization.id}>
                  <Link
                    href={`/platform/organizations/${organization.id}`}
                    className="card block px-4 py-3 transition-colors hover:border-brand-700/40 hover:bg-brand-50/30"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-bold text-ink-950">
                            {organization.name}
                          </p>
                          <OrgStatusBadge status={organization.status} />
                          <PlanBadge plan={organization.plan} />
                        </div>
                        <p className="mt-0.5 truncate text-xs text-ink-500">
                          {BUSINESS_TYPE_LABELS[organization.businessType] ??
                            organization.businessType}
                          {organization.city ? ` · ${organization.city}` : ""}
                          {organization.state ? `, ${organization.state}` : ""}
                          {" · "}
                          {organization.email}
                        </p>
                        <p className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-ink-500">
                          <span className="inline-flex items-center gap-1">
                            <Users className="size-3.5" />
                            {organization._count.users}{" "}
                            {organization._count.users === 1 ? "person" : "people"}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Store className="size-3.5" />
                            {organization._count.branches}{" "}
                            {organization._count.branches === 1 ? "shop" : "shops"}
                          </span>
                          <span>joined {formatDate(organization.createdAt)}</span>
                        </p>
                      </div>

                      <div className="shrink-0 text-right">
                        {subscription ? (
                          <>
                            <p
                              className={`text-xs font-bold ${
                                lapsed
                                  ? "text-bad-700"
                                  : urgent
                                    ? "text-warn-700"
                                    : "text-ink-600"
                              }`}
                            >
                              {lapsed
                                ? `Lapsed ${Math.abs(daysLeft!)}d ago`
                                : daysLeft === 0
                                  ? "Expires today"
                                  : `${daysLeft}d left`}
                            </p>
                            <p className="mt-0.5 text-xs text-ink-400">
                              to {formatDate(subscription.expiresAt)}
                            </p>
                            <p className="tabular mt-0.5 text-xs font-semibold text-ink-500">
                              {formatNairaCompact(subscription.amountPaidKobo)}
                            </p>
                          </>
                        ) : (
                          <p className="text-xs font-semibold text-ink-400">No subscription</p>
                        )}
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>

          {pages > 1 ? (
            <nav
              aria-label="Pagination"
              className="flex items-center justify-between gap-3 pt-1"
            >
              <p className="text-xs text-ink-500">
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of{" "}
                {total.toLocaleString()}
              </p>
              <div className="flex gap-2">
                {page > 1 ? (
                  <Link href={pageHref(page - 1)} className="btn btn-outline btn-sm">
                    <ChevronLeft className="size-4" />
                    Previous
                  </Link>
                ) : null}
                {page < pages ? (
                  <Link href={pageHref(page + 1)} className="btn btn-outline btn-sm">
                    Next
                    <ChevronRight className="size-4" />
                  </Link>
                ) : null}
              </div>
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}
