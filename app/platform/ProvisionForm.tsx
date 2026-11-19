"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  Check,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  MailCheck,
  MailWarning,
  Rocket,
} from "lucide-react";

import {
  BUSINESS_TYPES,
  BUSINESS_TYPE_LABELS,
  NIGERIAN_STATES,
  PLANS,
  PLAN_ORDER,
  UNLIMITED,
  type PlanId,
} from "@/lib/constants";
import { formatNaira, fromKobo, toKobo } from "@/lib/money";

/**
 * The provisioning form.
 *
 * Everything here is pre-filled from the request, because the operator has
 * already read those details in the email thread and re-typing them is how
 * typos get into a customer's account name. The fields stay editable because the
 * details on a landing-page form are frequently wrong — people type "Mama
 * Nkechi" and mean "Mama Nkechi Supermarket Ltd", or give a personal Gmail and
 * want the shop's address used for the account.
 *
 * The temporary password comes back exactly once, in the response body. That is
 * a deliberate constraint, not an oversight: it is never stored in plaintext, so
 * there is nowhere to fetch it from later. The success panel therefore refuses
 * to be dismissed by accident — no auto-redirect, no timeout, and a copy button
 * that confirms it copied.
 */

interface Props {
  leadId?: string;
  defaults: {
    organizationName: string;
    businessType: string;
    email: string;
    phone: string;
    whatsapp: string;
    state: string;
    city: string;
    address: string;
    plan: PlanId;
    quotedKobo: number;
    adminName: string;
    adminPhone: string;
  };
}

interface Success {
  organizationId: string;
  /**
   * Taken from what was submitted, not from `defaults` — on the walk-in path
   * (`/platform/organizations/new`) the defaults are all blank, and reading the
   * heading off them produced "  is live".
   */
  organizationName: string;
  adminEmail: string;
  tempPassword: string;
  expiresAt: string;
  emailDelivered: boolean;
  emailError?: string;
  emailFix?: string | null;
}

export function ProvisionForm({ leadId, defaults }: Props) {
  const router = useRouter();
  const [plan, setPlan] = useState<PlanId>(defaults.plan);
  const [amount, setAmount] = useState(String(fromKobo(defaults.quotedKobo || PLANS[defaults.plan].priceKobo)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState<Success | null>(null);

  /**
   * Switching plan re-quotes the amount. If the operator had typed a negotiated
   * figure, replacing it would be rude — but leaving ₦50,000 next to
   * "Enterprise" is worse, because that is the number that ends up on the
   * subscription record and in the renewal reminder a year from now.
   */
  function onPlanChange(next: PlanId) {
    setPlan(next);
    setAmount(String(fromKobo(PLANS[next].priceKobo)));
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;

    setBusy(true);
    setError(null);
    setFields({});

    try {
      const response = await fetch("/api/platform/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          leadId,
          plan,
          amountKobo: toKobo(data.amountNaira || "0"),
          amountPaidKobo: toKobo(data.amountPaidNaira || data.amountNaira || "0"),
          startPending: data.startPending === "on",
        }),
      });
      const body = await response.json();

      if (!response.ok) {
        setError(body.error ?? "That didn't go through. Please try again.");
        setFields(body.fields ?? {});
        setBusy(false);
        return;
      }

      setSuccess({
        ...(body as Omit<Success, "organizationName">),
        organizationName: data.organizationName?.trim() || defaults.organizationName,
      });
      // Refresh so the lead's status pill and the nav counts reflect reality
      // behind the success panel.
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (success) return <SuccessPanel success={success} />;

  const seats = PLANS[plan].seats;
  const seatLine = (n: number) => (n === UNLIMITED ? "Unlimited" : String(n));

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      {/* ── Plan & payment ────────────────────────────────────────────────── */}
      <section>
        <h3 className="section-title mb-2">Plan &amp; payment</h3>
        <div className="grid gap-2 sm:grid-cols-3">
          {PLAN_ORDER.map((id) => {
            const definition = PLANS[id];
            const selected = plan === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onPlanChange(id)}
                aria-pressed={selected}
                className={`rounded-xl border p-3 text-left transition-colors ${
                  selected
                    ? "border-brand-700 bg-brand-50 ring-1 ring-brand-700"
                    : "border-ink-200 bg-white hover:border-ink-300"
                }`}
              >
                <span className="flex items-center justify-between">
                  <span className="text-sm font-bold text-ink-950">{definition.name}</span>
                  {selected ? <Check className="size-4 text-brand-700" strokeWidth={3} /> : null}
                </span>
                <span className="tabular mt-1 block text-sm font-semibold text-brand-700">
                  {formatNaira(definition.priceKobo)}
                </span>
                <span className="mt-0.5 block text-[0.6875rem] text-ink-500">per year</span>
              </button>
            );
          })}
        </div>

        <p className="hint">
          {seatLine(seats.mainAdmin)} main admin{seats.mainAdmin === 1 ? "" : "s"} ·{" "}
          {seatLine(seats.subAdmin)} sub-admins · {seatLine(seats.cashier)} cashiers ·{" "}
          {seatLine(seats.branches)} branch{seats.branches === 1 ? "" : "es"}
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Field
            label="Amount invoiced (₦)"
            name="amountNaira"
            value={amount}
            onChange={setAmount}
            inputMode="decimal"
            error={fields.amountKobo}
          />
          <Field
            label="Amount received (₦)"
            name="amountPaidNaira"
            placeholder="Same as invoiced"
            inputMode="decimal"
            hint="Leave blank if paid in full."
          />
          <div>
            <label className="label" htmlFor="durationMonths">
              Valid for
            </label>
            <select id="durationMonths" name="durationMonths" defaultValue="12" className="input">
              <option value="12">12 months</option>
              <option value="24">24 months</option>
              <option value="6">6 months</option>
              <option value="3">3 months</option>
              <option value="1">1 month (trial)</option>
            </select>
          </div>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="paymentMethod">
              How they paid
            </label>
            <select
              id="paymentMethod"
              name="paymentMethod"
              defaultValue="BANK_TRANSFER"
              className="input"
            >
              <option value="BANK_TRANSFER">Bank transfer</option>
              <option value="CASH">Cash</option>
              <option value="CARD">Card</option>
              <option value="OTHER">Other</option>
            </select>
          </div>
          <Field
            label="Payment reference"
            name="paymentReference"
            placeholder="Transfer narration or teller no."
            error={fields.paymentReference}
          />
        </div>
      </section>

      {/* ── The business ──────────────────────────────────────────────────── */}
      <section>
        <h3 className="section-title mb-2">The business</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Registered name"
            name="organizationName"
            defaultValue={defaults.organizationName}
            required
            error={fields.organizationName}
            hint="Appears on every receipt."
          />
          <div>
            <label className="label" htmlFor="businessType">
              Type
            </label>
            <select
              id="businessType"
              name="businessType"
              defaultValue={
                BUSINESS_TYPES.includes(defaults.businessType as (typeof BUSINESS_TYPES)[number])
                  ? defaults.businessType
                  : "SUPERMARKET"
              }
              className="input"
            >
              {BUSINESS_TYPES.map((type) => (
                <option key={type} value={type}>
                  {BUSINESS_TYPE_LABELS[type] ?? type}
                </option>
              ))}
            </select>
          </div>
          <Field
            label="Business email"
            name="email"
            type="email"
            defaultValue={defaults.email}
            required
            error={fields.email}
          />
          <Field
            label="Business phone"
            name="phone"
            type="tel"
            defaultValue={defaults.phone}
            required
            error={fields.phone}
          />
          <Field
            label="WhatsApp"
            name="whatsapp"
            type="tel"
            defaultValue={defaults.whatsapp}
            hint="Where daily reports go. Defaults to the phone number."
          />
          <div>
            <label className="label" htmlFor="state">
              State
            </label>
            <select id="state" name="state" defaultValue={defaults.state} className="input">
              <option value="">Not set</option>
              {NIGERIAN_STATES.map((state) => (
                <option key={state} value={state}>
                  {state}
                </option>
              ))}
            </select>
          </div>
          <Field label="City / town" name="city" defaultValue={defaults.city} />
          <Field label="Street address" name="address" defaultValue={defaults.address} />
        </div>
      </section>

      {/* ── First shop ────────────────────────────────────────────────────── */}
      <section>
        <h3 className="section-title mb-2">First shop</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Shop name"
            name="branchName"
            placeholder="Main Shop"
            hint="They can rename it and add more later."
          />
          <Field
            label="Shop code"
            name="branchCode"
            placeholder="Auto"
            hint="Three letters, printed on receipts. Left blank we derive one."
          />
        </div>
      </section>

      {/* ── Main admin ────────────────────────────────────────────────────── */}
      <section>
        <h3 className="section-title mb-2">Main admin</h3>
        <p className="mb-3 text-xs leading-relaxed text-ink-500">
          This person gets full control of the account — staff, prices, reports,
          everything. Their email is their login and we send the temporary
          password there.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Full name"
            name="adminName"
            defaultValue={defaults.adminName}
            required
            error={fields.adminName}
          />
          <Field
            label="Login email"
            name="adminEmail"
            type="email"
            defaultValue={defaults.email}
            required
            error={fields.adminEmail}
          />
          <Field
            label="Phone"
            name="adminPhone"
            type="tel"
            defaultValue={defaults.adminPhone}
            error={fields.adminPhone}
          />
        </div>
      </section>

      {/* ── Notes & pending toggle ────────────────────────────────────────── */}
      <section>
        <label className="label" htmlFor="notes">
          Internal note <span className="font-normal text-ink-400">(optional)</span>
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={2}
          placeholder="Part payment, ₦30k balance due end of month…"
          className="input resize-y"
        />

        <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-lg border border-ink-200 bg-ink-50 p-3">
          <input type="checkbox" name="startPending" className="mt-0.5 size-4 accent-brand-700" />
          <span className="text-xs leading-relaxed text-ink-700">
            <span className="block font-semibold text-ink-900">
              Create the account but don&apos;t let them trade yet
            </span>
            Everyone can sign in and see the renewal screen, but the till and
            dashboard stay locked. Use this when payment is still partial.
          </span>
        </label>
      </section>

      {error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-bad-200 bg-bad-50 px-3 py-2.5 text-sm text-bad-700"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}

      <button type="submit" disabled={busy} className="btn btn-primary btn-lg w-full">
        {busy ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Creating the account…
          </>
        ) : (
          <>
            <Rocket className="size-4" />
            Create account &amp; send login
          </>
        )}
      </button>
      <p className="hint text-center">
        This creates the organization, the first shop and the main admin login in
        one step. The temporary password is shown once — copy it before closing.
      </p>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function SuccessPanel({ success }: { success: Success }) {
  const [revealed, setRevealed] = useState(true);
  const [copied, setCopied] = useState(false);
  const organizationName = success.organizationName || "The business";

  async function copy() {
    try {
      await navigator.clipboard.writeText(success.tempPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard is blocked over plain http on some browsers. The password is
      // on screen in plain text, so there is nothing to recover from — selecting
      // it by hand still works.
      setRevealed(true);
    }
  }

  return (
    <div className="animate-slide-up space-y-4">
      <div className="text-center">
        <div className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-good-50">
          <Check className="size-6 text-good-700" strokeWidth={3} />
        </div>
        <h3 className="text-lg font-bold text-ink-950">{organizationName} is live</h3>
        <p className="mt-1 text-sm text-ink-600">
          Subscription runs to {new Date(success.expiresAt).toLocaleDateString("en-NG", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
          .
        </p>
      </div>

      <div className="rounded-xl border-2 border-brand-700 bg-brand-50 p-4">
        <p className="text-xs font-bold uppercase tracking-wide text-brand-800">
          Temporary password — shown once
        </p>
        <p className="mt-1 text-xs leading-relaxed text-ink-600">
          We do not store this. If you lose it, reset the password from the
          business&apos;s page instead of looking for it here.
        </p>

        <div className="mt-3 space-y-2">
          <div>
            <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-500">
              Login
            </p>
            <p className="font-mono text-sm font-semibold text-ink-950">{success.adminEmail}</p>
          </div>
          <div>
            <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-500">
              Password
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-lg border border-brand-200 bg-white px-3 py-2 font-mono text-base font-bold tracking-wider text-ink-950">
                {revealed ? success.tempPassword : "•".repeat(success.tempPassword.length)}
              </code>
              <button
                type="button"
                onClick={() => setRevealed((value) => !value)}
                className="btn btn-outline btn-icon"
                aria-label={revealed ? "Hide password" : "Show password"}
              >
                {revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
              <button type="button" onClick={copy} className="btn btn-primary btn-sm">
                {copied ? (
                  <>
                    <Check className="size-4" strokeWidth={3} />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="size-4" />
                    Copy
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      <p
        className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${
          success.emailDelivered
            ? "border-good-200 bg-good-50 text-good-700"
            : "border-warn-200 bg-warn-50 text-warn-700"
        }`}
      >
        {success.emailDelivered ? (
          <>
            <MailCheck className="mt-0.5 size-4 shrink-0" />
            Welcome email sent to {success.adminEmail} with these details.
          </>
        ) : (
          <>
            <MailWarning className="mt-0.5 size-4 shrink-0" />
            <span>
              The welcome email did not send. The account itself is fine: copy the password above and
              send it to {success.adminEmail} yourself.
              {success.emailError && (
                <span className="mt-1.5 block font-mono text-xs">Resend said: {success.emailError}</span>
              )}
              {success.emailFix && <span className="mt-1.5 block font-semibold">{success.emailFix}</span>}
              <Link href="/platform/email" className="mt-1.5 block font-semibold underline">
                Open the Email page to test your setup
              </Link>
            </span>
          </>
        )}
      </p>

      <Link
        href={`/platform/organizations/${success.organizationId}`}
        className="btn btn-dark w-full"
      >
        Open {organizationName}
        <ArrowRight className="size-4" />
      </Link>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function Field({
  label,
  name,
  hint,
  error,
  value,
  onChange,
  ...rest
}: {
  label: string;
  name: string;
  hint?: string;
  error?: string;
  value?: string;
  onChange?: (value: string) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "name" | "value" | "onChange">) {
  return (
    <div>
      <label className="label" htmlFor={name}>
        {label}
      </label>
      <input
        id={name}
        name={name}
        className="input"
        aria-invalid={error ? "true" : undefined}
        aria-describedby={error ? `${name}-error` : hint ? `${name}-hint` : undefined}
        {...(onChange ? { value: value ?? "", onChange: (e) => onChange(e.target.value) } : {})}
        {...rest}
      />
      {error ? (
        <p id={`${name}-error`} className="error-text">
          {error}
        </p>
      ) : hint ? (
        <p id={`${name}-hint`} className="hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
