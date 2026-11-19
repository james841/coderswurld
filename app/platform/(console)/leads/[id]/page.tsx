import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Rocket,
  Store,
  Users,
} from "lucide-react";

import { prisma } from "@/lib/db";
import { formatDateTime, relativeDays } from "@/lib/dates";
import { formatNaira } from "@/lib/money";
import { BUSINESS_TYPE_LABELS, getPlan, type PlanId } from "@/lib/constants";
import { LeadStatusBadge, PlanBadge } from "../../../StatusBadges";
import { ProvisionForm } from "../../../ProvisionForm";
import { LeadNotes, LeadPipeline } from "./LeadPipeline";

export const metadata: Metadata = { title: "Request" };

/**
 * One request, and everything you do to it.
 *
 * Laid out in the order the work actually happens: read who they are, move them
 * along the pipeline, then provision. The provisioning form sits at the bottom
 * and is only expanded once they've paid — it is a long form, and having it open
 * on a lead that hasn't sent money yet is an invitation to create an account
 * nobody paid for.
 */
export default async function LeadDetailPage({ params }: PageProps<"/platform/leads/[id]">) {
  const { id } = await params;

  const lead = await prisma.lead.findUnique({
    where: { id },
    include: {
      organization: {
        select: { id: true, name: true, status: true, slug: true },
      },
    },
  });

  if (!lead) notFound();

  const plan = getPlan(lead.plan);
  const now = new Date();
  const paid = lead.status === "PAID";
  const provisioned = lead.status === "PROVISIONED" || lead.organizationId !== null;
  const hasBankDetails = Boolean(
    process.env.PAYMENT_BANK_NAME && process.env.PAYMENT_ACCOUNT_NUMBER,
  );

  // The form's admin-name default: the contact person is nearly always the main
  // admin, and when they aren't, the operator edits one field instead of two.
  const suggestedPlan: PlanId = (["STARTER", "BUSINESS", "ENTERPRISE"] as const).includes(
    lead.plan as PlanId,
  )
    ? (lead.plan as PlanId)
    : "STARTER";

  return (
    <div className="space-y-5">
      <Link
        href="/platform/leads"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-500 transition-colors hover:text-brand-700"
      >
        <ArrowLeft className="size-4" />
        All requests
      </Link>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <header className="card card-pad">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-ink-950">
                {lead.companyName}
              </h1>
              <LeadStatusBadge status={lead.status} />
              <PlanBadge plan={lead.plan} />
            </div>
            <p className="mt-1 text-sm text-ink-500">
              <span className="font-mono font-semibold text-brand-700">{lead.reference}</span>
              {" · "}
              {BUSINESS_TYPE_LABELS[lead.businessType] ?? lead.businessType}
              {" · received "}
              {relativeDays(lead.createdAt, now)}
            </p>
          </div>

          <div className="text-right">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
              Quoted
            </p>
            <p className="tabular text-2xl font-bold tracking-tight text-ink-950">
              {formatNaira(lead.quotedKobo)}
            </p>
            <p className="text-xs text-ink-500">
              {plan.name} · {lead.billingCycle === "YEARLY" ? "one year" : lead.billingCycle.toLowerCase()}
            </p>
          </div>
        </div>

        {/* One-tap contact. The operator's next action is almost always to call
            or WhatsApp this person, and hunting for the number to copy is the
            kind of friction that turns a two-minute follow-up into tomorrow's. */}
        <div className="mt-4 flex flex-wrap gap-2 border-t border-hairline pt-4">
          <a
            href={`mailto:${lead.email}?subject=${encodeURIComponent(`[${lead.reference}] ${plan.name} plan, ${lead.companyName}`)}`}
            className="btn btn-outline btn-sm"
          >
            <Mail className="size-4" />
            {lead.email}
          </a>
          <a href={`tel:${lead.phone}`} className="btn btn-outline btn-sm">
            <Phone className="size-4" />
            {lead.phone}
          </a>
          {lead.whatsapp ? (
            <a
              href={`https://wa.me/${lead.whatsapp.replace(/[^\d]/g, "")}`}
              target="_blank"
              rel="noreferrer"
              className="btn btn-outline btn-sm"
            >
              <MessageCircle className="size-4" />
              WhatsApp
            </a>
          ) : null}
        </div>
      </header>

      {/* ── What the customer reported when they tapped "I've paid" ──────── */}
      {lead.paymentClaimedAt ? (
        <section className="card card-pad border-brand-200 bg-brand-50/60">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-brand-800">Customer says they&apos;ve paid</p>
              <p className="mt-1 text-sm text-ink-700">
                Reported {relativeDays(lead.paymentClaimedAt, now)}. Check your bank for this transfer, then mark it paid
                and create their account below.
              </p>
            </div>
            <p className="tabular text-2xl font-bold text-ink-950">
              {lead.paymentAmountKobo !== null ? formatNaira(lead.paymentAmountKobo) : "—"}
            </p>
          </div>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">Name on transfer</dt>
              <dd className="font-semibold text-ink-950">{lead.paymentSenderName ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">Date paid</dt>
              <dd className="font-semibold text-ink-950">
                {lead.paymentPaidOn
                  ? lead.paymentPaidOn.toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">From bank</dt>
              <dd className="font-semibold text-ink-950">{lead.paymentBank ?? "—"}</dd>
            </div>
          </dl>
          {lead.paymentAmountKobo !== null && lead.paymentAmountKobo < lead.quotedKobo ? (
            <p className="mt-3 rounded-lg bg-sell-50 px-3 py-2 text-sm font-semibold text-sell-700">
              This is less than the quoted {formatNaira(lead.quotedKobo)}.
            </p>
          ) : null}
          {lead.paymentNote ? (
            <p className="mt-3 rounded-lg bg-white px-3 py-2 text-sm text-ink-700 ring-1 ring-hairline">“{lead.paymentNote}”</p>
          ) : null}
        </section>
      ) : null}

      {/* ── Already live ──────────────────────────────────────────────────── */}
      {provisioned && lead.organization ? (
        <section className="card card-pad border-good-200 bg-good-50">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="flex items-center gap-2 text-sm font-bold text-good-700">
                <Rocket className="size-4" />
                This business is live
              </p>
              <p className="mt-0.5 text-sm text-ink-700">
                Provisioned as <strong>{lead.organization.name}</strong>. Manage the
                plan, staff and subscription from its own page.
              </p>
            </div>
            <Link
              href={`/platform/organizations/${lead.organization.id}`}
              className="btn btn-dark btn-sm"
            >
              Open business
              <ArrowRight className="size-4" />
            </Link>
          </div>
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        {/* ── Left column ─────────────────────────────────────────────────── */}
        <div className="space-y-4">
          {!provisioned ? (
            <section className="card card-pad">
              <h2 className="text-sm font-bold text-ink-950">Where this stands</h2>
              <p className="mb-3 mt-0.5 text-xs text-ink-500">
                Each button records the date as well as the status.
              </p>
              <LeadPipeline
                leadId={lead.id}
                status={lead.status}
                hasBankDetails={hasBankDetails}
              />
            </section>
          ) : null}

          {!provisioned ? (
            <section className="card">
              <header className="border-b border-hairline px-4 py-3">
                <h2 className="text-sm font-bold text-ink-950">
                  {paid ? "Create their account" : "Provisioning"}
                </h2>
                <p className="mt-0.5 text-xs text-ink-500">
                  {paid
                    ? "Payment is recorded. Creating the account sends the main admin their login."
                    : "Available once payment is recorded. Mark them paid above, or expand anyway if you're taking payment now."}
                </p>
              </header>
              <div className="p-4">
                {paid ? (
                  <ProvisionForm
                    leadId={lead.id}
                    defaults={{
                      organizationName: lead.companyName,
                      businessType: lead.businessType,
                      email: lead.email,
                      phone: lead.phone,
                      whatsapp: lead.whatsapp ?? "",
                      state: lead.state ?? "",
                      city: lead.city ?? "",
                      address: lead.address ?? "",
                      plan: suggestedPlan,
                      quotedKobo: lead.quotedKobo,
                      adminName: lead.contactName,
                      adminPhone: lead.phone,
                    }}
                  />
                ) : (
                  <details className="group">
                    <summary className="cursor-pointer list-none rounded-lg border border-dashed border-ink-300 px-4 py-3 text-center text-sm font-semibold text-ink-600 transition-colors hover:border-brand-700 hover:text-brand-700">
                      Create the account anyway
                      <span className="mt-0.5 block text-xs font-normal text-ink-400">
                        For walk-ins and cash payments taken on the spot
                      </span>
                    </summary>
                    <div className="mt-4">
                      <ProvisionForm
                        leadId={lead.id}
                        defaults={{
                          organizationName: lead.companyName,
                          businessType: lead.businessType,
                          email: lead.email,
                          phone: lead.phone,
                          whatsapp: lead.whatsapp ?? "",
                          state: lead.state ?? "",
                          city: lead.city ?? "",
                          address: lead.address ?? "",
                          plan: suggestedPlan,
                          quotedKobo: lead.quotedKobo,
                          adminName: lead.contactName,
                          adminPhone: lead.phone,
                        }}
                      />
                    </div>
                  </details>
                )}
              </div>
            </section>
          ) : null}

          {/* ── What they told us ─────────────────────────────────────────── */}
          <section className="card">
            <header className="border-b border-hairline px-4 py-3">
              <h2 className="text-sm font-bold text-ink-950">What they told us</h2>
            </header>
            <dl className="divide-y divide-hairline">
              <Row icon={Users} label="Contact">
                {lead.contactName}
                {lead.contactRole ? (
                  <span className="text-ink-500"> · {lead.contactRole}</span>
                ) : null}
              </Row>
              <Row icon={MapPin} label="Location">
                {[lead.address, lead.city, lead.state].filter(Boolean).join(", ") || "Not given"}
              </Row>
              <Row icon={Store} label="Shops">
                {lead.branchCount} branch{lead.branchCount === 1 ? "" : "es"}
              </Row>
              <Row icon={Users} label="Staff">
                {lead.staffCount} {lead.staffCount === 1 ? "person" : "people"}
              </Row>
              <Row icon={Building2} label="Products">
                {lead.skuEstimate > 0
                  ? `about ${lead.skuEstimate.toLocaleString()} items`
                  : "Not given"}
              </Row>
            </dl>

            {lead.notes ? (
              <div className="border-t border-hairline px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                  Their note
                </p>
                <p className="mt-1.5 whitespace-pre-wrap rounded-lg border-l-2 border-brand-700 bg-ink-50 px-3 py-2 text-sm leading-relaxed text-ink-700">
                  {lead.notes}
                </p>
              </div>
            ) : null}
          </section>
        </div>

        {/* ── Right column ────────────────────────────────────────────────── */}
        <div className="space-y-4">
          <section className="card">
            <header className="border-b border-hairline px-4 py-3">
              <h2 className="text-sm font-bold text-ink-950">History</h2>
            </header>
            {/* Only stamped events appear here. There is no `contactedAt`
                column, and showing `updatedAt` in its place would put a
                timestamp next to "Marked contacted" that actually moves every
                time the note is edited. */}
            <ul className="space-y-3 px-4 py-3 text-xs">
              <Event label="Request received" at={lead.createdAt} />
              <Event label="Invoice sent" at={lead.invoicedAt} />
              <Event label="Payment received" at={lead.paidAt} />
              <Event label="Not proceeding" at={lead.rejectedAt} />
              <Event label="Account created" at={provisioned ? lead.updatedAt : null} muted />
            </ul>
          </section>

          <section className="card">
            <header className="border-b border-hairline px-4 py-3">
              <h2 className="text-sm font-bold text-ink-950">Internal note</h2>
              <p className="mt-0.5 text-xs text-ink-500">Only you can see this.</p>
            </header>
            <div className="p-4">
              <LeadNotes leadId={lead.id} initial={lead.notes ?? ""} />
            </div>
          </section>

          <section className="card card-pad">
            <h2 className="text-sm font-bold text-ink-950">{plan.name} plan</h2>
            <p className="tabular mt-1 text-lg font-bold text-brand-700">
              {formatNaira(plan.priceKobo)}
              <span className="text-xs font-semibold text-ink-500"> /year</span>
            </p>
            <ul className="mt-3 space-y-1.5">
              {plan.features.slice(0, 5).map((feature) => (
                <li key={feature} className="flex gap-2 text-xs leading-relaxed text-ink-600">
                  <span className="mt-1.5 size-1 shrink-0 rounded-full bg-brand-700" />
                  {feature}
                </li>
              ))}
            </ul>
            {lead.quotedKobo !== plan.priceKobo ? (
              <p className="hint">
                Quoted {formatNaira(lead.quotedKobo)}, {lead.quotedKobo < plan.priceKobo ? "discounted" : "above"} list
                price.
              </p>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function Row({
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
      <dt className="flex w-28 shrink-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">
        <Icon className="size-3.5" />
        {label}
      </dt>
      <dd className="min-w-0 flex-1 text-sm text-ink-800">{children}</dd>
    </div>
  );
}

function Event({
  label,
  at,
  muted,
}: {
  label: string;
  at: Date | null;
  muted?: boolean;
}) {
  if (!at) {
    return (
      <li className="flex items-baseline gap-2.5 text-ink-300">
        <span className="mt-1.5 size-1.5 shrink-0 rounded-full border border-ink-200" />
        <span className="flex-1">{label}</span>
      </li>
    );
  }
  return (
    <li className="flex items-baseline gap-2.5">
      <span
        className={`mt-1.5 size-1.5 shrink-0 rounded-full ${muted ? "bg-ink-300" : "bg-brand-700"}`}
      />
      <span className="flex-1 font-semibold text-ink-800">{label}</span>
      <span className="shrink-0 text-ink-500">{formatDateTime(at)}</span>
    </li>
  );
}
