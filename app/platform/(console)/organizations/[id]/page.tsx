import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Boxes,
  Building2,
  Clock,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Receipt,
  Store,
  Users,
} from "lucide-react";

import { prisma } from "@/lib/db";
import { daysBetween, formatDate, formatDateTime } from "@/lib/dates";
import { formatNaira, formatNairaCompact } from "@/lib/money";
import { BUSINESS_TYPE_LABELS, getPlan, ROLE_LABELS, type Role } from "@/lib/constants";
import { OrgStatusBadge, PlanBadge } from "../../../StatusBadges";
import {
  ContactForm,
  PlanControl,
  RenewForm,
  StaffList,
  StatusControls,
} from "./OrgControls";

export const metadata: Metadata = { title: "Business" };

/**
 * One business, and everything the platform can do to it.
 *
 * The operator opens this screen for one of three reasons: somebody paid,
 * somebody can't log in, or somebody is asking what they're paying for. Those
 * three answers are the top of the page. Usage numbers are further down — they
 * are interesting, but nobody has ever phoned about them.
 *
 * Read-heavy by design: eleven aggregates, one round trip.
 */
export default async function OrganizationDetailPage({
  params,
}: PageProps<"/platform/organizations/[id]">) {
  const { id } = await params;

  const organization = await prisma.organization.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      slug: true,
      businessType: true,
      email: true,
      phone: true,
      whatsapp: true,
      address: true,
      city: true,
      state: true,
      plan: true,
      status: true,
      createdAt: true,
      activatedAt: true,
      suspendedAt: true,
      lead: { select: { id: true, reference: true } },
    },
  });

  if (!organization) notFound();

  const now = new Date();

  const [
    subscriptions,
    admins,
    userCounts,
    branches,
    productCount,
    salesAgg,
    lastSale,
    auditLogs,
  ] = await Promise.all([
    prisma.subscription.findMany({
      where: { organizationId: id },
      orderBy: { startsAt: "desc" },
      take: 12,
      select: {
        id: true,
        plan: true,
        status: true,
        amountKobo: true,
        amountPaidKobo: true,
        startsAt: true,
        expiresAt: true,
        paymentMethod: true,
        paymentReference: true,
        notes: true,
      },
    }),
    // Only admin logins. A cashier's PIN is their own admin's business, and
    // listing forty tills here would bury the two rows that matter.
    prisma.user.findMany({
      where: { organizationId: id, role: { in: ["MAIN_ADMIN", "SUB_ADMIN"] } },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
      },
    }),
    prisma.user.groupBy({
      by: ["role"],
      where: { organizationId: id, isActive: true },
      _count: { _all: true },
    }),
    prisma.branch.findMany({
      where: { organizationId: id },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, code: true, isActive: true, isMain: true },
    }),
    prisma.product.count({ where: { organizationId: id, isActive: true } }),
    prisma.sale.aggregate({
      where: { organizationId: id, status: "COMPLETED" },
      _count: { _all: true },
      _sum: { totalKobo: true },
    }),
    // `soldAt`, not `createdAt`: a sale made offline on Saturday and synced on
    // Monday has a Monday `createdAt`, and "last sale Monday" would be a lie
    // about when the shop was actually open.
    prisma.sale.findFirst({
      where: { organizationId: id, status: "COMPLETED" },
      orderBy: { soldAt: "desc" },
      select: { soldAt: true },
    }),
    prisma.auditLog.findMany({
      where: { organizationId: id },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: {
        id: true,
        action: true,
        summary: true,
        userName: true,
        createdAt: true,
      },
    }),
  ]);

  const active = subscriptions.find((subscription) => subscription.status === "ACTIVE");
  const daysLeft = active ? daysBetween(now, active.expiresAt) : null;
  const plan = getPlan(organization.plan);

  const totalPaidKobo = subscriptions.reduce(
    (sum, subscription) => sum + subscription.amountPaidKobo,
    0,
  );
  const roleCount = new Map(userCounts.map((row) => [row.role, row._count._all]));

  return (
    <div className="space-y-5">
      <Link
        href="/platform/organizations"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-500 transition-colors hover:text-brand-700"
      >
        <ArrowLeft className="size-4" />
        All businesses
      </Link>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <header className="card card-pad">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-ink-950">
                {organization.name}
              </h1>
              <OrgStatusBadge status={organization.status} />
              <PlanBadge plan={organization.plan} />
            </div>
            <p className="mt-1 text-sm text-ink-500">
              {BUSINESS_TYPE_LABELS[organization.businessType] ?? organization.businessType}
              {organization.city ? ` · ${organization.city}` : ""}
              {organization.state ? `, ${organization.state}` : ""}
              {" · customer since "}
              {formatDate(organization.createdAt)}
            </p>
          </div>

          <div className="text-right">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
              Subscription
            </p>
            {active ? (
              <>
                <p
                  className={`text-lg font-bold ${
                    daysLeft !== null && daysLeft < 0
                      ? "text-bad-700"
                      : daysLeft !== null && daysLeft <= 30
                        ? "text-warn-700"
                        : "text-ink-950"
                  }`}
                >
                  {daysLeft !== null && daysLeft < 0
                    ? `Lapsed ${Math.abs(daysLeft)} days ago`
                    : daysLeft === 0
                      ? "Expires today"
                      : `${daysLeft} days left`}
                </p>
                <p className="text-xs text-ink-500">to {formatDate(active.expiresAt)}</p>
              </>
            ) : (
              <p className="text-lg font-bold text-ink-400">None on record</p>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 border-t border-hairline pt-4">
          <a href={`mailto:${organization.email}`} className="btn btn-outline btn-sm">
            <Mail className="size-4" />
            {organization.email}
          </a>
          <a href={`tel:${organization.phone}`} className="btn btn-outline btn-sm">
            <Phone className="size-4" />
            {organization.phone}
          </a>
          {organization.whatsapp ? (
            <a
              href={`https://wa.me/${organization.whatsapp.replace(/[^\d]/g, "")}`}
              target="_blank"
              rel="noreferrer"
              className="btn btn-outline btn-sm"
            >
              <MessageCircle className="size-4" />
              WhatsApp
            </a>
          ) : null}
          {organization.lead ? (
            <Link href={`/platform/leads/${organization.lead.id}`} className="btn btn-ghost btn-sm">
              <Receipt className="size-4" />
              Original request {organization.lead.reference}
            </Link>
          ) : null}
        </div>
      </header>

      {/* ── Usage ─────────────────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={Receipt}
          label="Sales rung up"
          value={(salesAgg._count._all ?? 0).toLocaleString()}
          note={
            lastSale
              ? `last ${formatDate(lastSale.soldAt)}`
              : "no sales yet — they may need help getting started"
          }
        />
        <Stat
          icon={Boxes}
          label="Products"
          value={productCount.toLocaleString()}
          note={productCount === 0 ? "catalogue is empty" : "in the catalogue"}
        />
        <Stat
          icon={Users}
          label="Staff"
          value={String(
            (roleCount.get("MAIN_ADMIN") ?? 0) +
              (roleCount.get("SUB_ADMIN") ?? 0) +
              (roleCount.get("MANAGER") ?? 0) +
              (roleCount.get("CASHIER") ?? 0) +
              (roleCount.get("STOREKEEPER") ?? 0),
          )}
          note={`${roleCount.get("CASHIER") ?? 0} at the till`}
        />
        <Stat
          icon={Store}
          label="Turnover through us"
          value={formatNairaCompact(salesAgg._sum.totalKobo ?? 0)}
          note={`they've paid us ${formatNairaCompact(totalPaidKobo)}`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        {/* ── Left column ───────────────────────────────────────────────── */}
        <div className="space-y-4">
          {/* Access */}
          <section className="card">
            <header className="border-b border-hairline px-4 py-3">
              <h2 className="text-sm font-bold text-ink-950">Access</h2>
              <p className="mt-0.5 text-xs text-ink-500">
                {organization.status === "ACTIVE"
                  ? "They can sign in and sell."
                  : organization.status === "PENDING"
                    ? "They can sign in but cannot sell yet."
                    : organization.status === "SUSPENDED"
                      ? `Suspended${organization.suspendedAt ? ` on ${formatDate(organization.suspendedAt)}` : ""}. Nobody can trade.`
                      : "Subscription lapsed. Nobody can trade until it is renewed."}
              </p>
            </header>
            <div className="space-y-4 p-4">
              <StatusControls
                organizationId={organization.id}
                organizationName={organization.name}
                status={organization.status}
              />
              <div className="border-t border-hairline pt-4">
                <RenewForm
                  organizationId={organization.id}
                  currentPlan={organization.plan}
                  expiresAt={active ? active.expiresAt.toISOString() : null}
                />
              </div>
            </div>
          </section>

          {/* Plan */}
          <section className="card">
            <header className="border-b border-hairline px-4 py-3">
              <h2 className="text-sm font-bold text-ink-950">Plan</h2>
              <p className="mt-0.5 text-xs text-ink-500">
                On {plan.name} at {formatNaira(plan.priceKobo)} a year.
              </p>
            </header>
            <div className="p-4">
              <PlanControl organizationId={organization.id} currentPlan={organization.plan} />
            </div>
          </section>

          {/* Admin logins */}
          <section className="card">
            <header className="border-b border-hairline px-4 py-3">
              <h2 className="text-sm font-bold text-ink-950">Admin logins</h2>
              <p className="mt-0.5 text-xs text-ink-500">
                Resetting a password signs that person out everywhere and forces
                them to choose a new one.
              </p>
            </header>
            <StaffList
              organizationId={organization.id}
              users={admins.map((admin) => ({
                ...admin,
                lastLoginAt: admin.lastLoginAt ? admin.lastLoginAt.toISOString() : null,
              }))}
            />
          </section>

          {/* Payment history */}
          <section className="card">
            <header className="border-b border-hairline px-4 py-3">
              <h2 className="text-sm font-bold text-ink-950">Payments</h2>
              <p className="mt-0.5 text-xs text-ink-500">
                {subscriptions.length === 0
                  ? "Nothing recorded."
                  : `${formatNaira(totalPaidKobo)} across ${subscriptions.length} ${subscriptions.length === 1 ? "term" : "terms"}.`}
              </p>
            </header>
            {subscriptions.length === 0 ? (
              <p className="px-4 py-3 text-sm text-ink-500">
                This account has no subscription on record — it was created
                without one, or the record was removed.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-hairline text-left text-xs uppercase tracking-wide text-ink-500">
                      <th className="px-4 py-2 font-semibold">Term</th>
                      <th className="px-4 py-2 font-semibold">Plan</th>
                      <th className="px-4 py-2 text-right font-semibold">Paid</th>
                      <th className="px-4 py-2 font-semibold">Method</th>
                      <th className="px-4 py-2 font-semibold">State</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hairline">
                    {subscriptions.map((subscription) => (
                      <tr key={subscription.id}>
                        <td className="whitespace-nowrap px-4 py-2 text-ink-800">
                          {formatDate(subscription.startsAt)} –{" "}
                          {formatDate(subscription.expiresAt)}
                        </td>
                        <td className="px-4 py-2">
                          <PlanBadge plan={subscription.plan} />
                        </td>
                        <td className="tabular whitespace-nowrap px-4 py-2 text-right font-semibold text-ink-900">
                          {formatNaira(subscription.amountPaidKobo)}
                          {subscription.amountPaidKobo < subscription.amountKobo ? (
                            <span className="block text-xs font-normal text-warn-700">
                              of {formatNaira(subscription.amountKobo)}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-2 text-xs text-ink-600">
                          {(subscription.paymentMethod ?? "—").replace("_", " ").toLowerCase()}
                          {subscription.paymentReference ? (
                            <span className="block font-mono text-ink-400">
                              {subscription.paymentReference}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-2">
                          <span
                            className={`text-xs font-bold ${
                              subscription.status === "ACTIVE"
                                ? "text-good-700"
                                : "text-ink-400"
                            }`}
                          >
                            {subscription.status === "ACTIVE" ? "Current" : "Past"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        {/* ── Right column ──────────────────────────────────────────────── */}
        <div className="space-y-4">
          {/* Shops */}
          <section className="card">
            <header className="border-b border-hairline px-4 py-3">
              <h2 className="text-sm font-bold text-ink-950">
                Shops <span className="font-normal text-ink-400">({branches.length})</span>
              </h2>
            </header>
            <ul className="divide-y divide-hairline">
              {branches.map((branch) => (
                <li key={branch.id} className="flex items-center gap-2 px-4 py-2.5 text-sm">
                  <Store className="size-3.5 shrink-0 text-ink-400" />
                  <span className="min-w-0 flex-1 truncate font-semibold text-ink-800">
                    {branch.name}
                    {branch.isMain ? (
                      <span className="font-normal text-ink-500"> · main</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 font-mono text-xs text-ink-400">{branch.code}</span>
                  {!branch.isActive ? (
                    <span className="shrink-0 text-xs text-ink-400">off</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>

          {/* Seats in use */}
          <section className="card card-pad">
            <h2 className="text-sm font-bold text-ink-950">Seats in use</h2>
            <ul className="mt-2 space-y-1.5">
              {(["MAIN_ADMIN", "SUB_ADMIN", "MANAGER", "STOREKEEPER", "CASHIER"] as Role[]).map(
                (role) => (
                  <li key={role} className="flex justify-between text-xs">
                    <span className="text-ink-600">{ROLE_LABELS[role]}</span>
                    <span className="tabular font-bold text-ink-900">
                      {roleCount.get(role) ?? 0}
                    </span>
                  </li>
                ),
              )}
            </ul>
            <p className="hint">
              Sub-admins, managers and storekeepers share one seat pool of{" "}
              {plan.seats.subAdmin === -1 ? "unlimited" : plan.seats.subAdmin}.
            </p>
          </section>

          {/* Details */}
          <section className="card">
            <header className="border-b border-hairline px-4 py-3">
              <h2 className="text-sm font-bold text-ink-950">Their details</h2>
              <p className="mt-0.5 text-xs text-ink-500">Fix a typo on their behalf.</p>
            </header>
            <div className="p-4">
              <ContactForm
                organizationId={organization.id}
                defaults={{
                  email: organization.email,
                  phone: organization.phone,
                  whatsapp: organization.whatsapp ?? "",
                }}
              />
            </div>
          </section>

          {/* Where they are */}
          <section className="card">
            <header className="border-b border-hairline px-4 py-3">
              <h2 className="text-sm font-bold text-ink-950">On record</h2>
            </header>
            <dl className="divide-y divide-hairline text-sm">
              <Detail icon={MapPin} label="Address">
                {[organization.address, organization.city, organization.state]
                  .filter(Boolean)
                  .join(", ") || "Not given"}
              </Detail>
              <Detail icon={Building2} label="Handle">
                <span className="font-mono text-xs">{organization.slug}</span>
              </Detail>
              <Detail icon={Clock} label="Activated">
                {organization.activatedAt ? formatDate(organization.activatedAt) : "Never"}
              </Detail>
            </dl>
          </section>

          {/* Audit trail */}
          <section className="card">
            <header className="border-b border-hairline px-4 py-3">
              <h2 className="text-sm font-bold text-ink-950">Recent activity</h2>
              <p className="mt-0.5 text-xs text-ink-500">
                Their own audit log, including what we do from here.
              </p>
            </header>
            {auditLogs.length === 0 ? (
              <p className="px-4 py-3 text-sm text-ink-500">Nothing logged yet.</p>
            ) : (
              <ul className="divide-y divide-hairline">
                {auditLogs.map((log) => (
                  <li key={log.id} className="px-4 py-2.5">
                    <p className="text-xs leading-relaxed text-ink-800">{log.summary}</p>
                    <p className="mt-0.5 text-[0.6875rem] text-ink-400">
                      {log.userName ?? "System"} · {formatDateTime(log.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function Stat({
  icon: Icon,
  label,
  value,
  note,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="card card-pad">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-ink-400" />
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</p>
      </div>
      <p className="tabular mt-1.5 text-2xl font-bold tracking-tight text-ink-950">{value}</p>
      <p className="mt-0.5 text-xs text-ink-500">{note}</p>
    </div>
  );
}

function Detail({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-3 px-4 py-2.5">
      <dt className="flex w-24 shrink-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">
        <Icon className="size-3.5" />
        {label}
      </dt>
      <dd className="min-w-0 flex-1 text-sm text-ink-800">{children}</dd>
    </div>
  );
}
