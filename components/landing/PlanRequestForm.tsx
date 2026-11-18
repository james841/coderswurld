"use client";

import { useState } from "react";
import { readAttribution } from "@/components/TrackView";
import { CheckCircle2, Loader2, AlertCircle } from "lucide-react";

import {
  PLANS,
  PLAN_ORDER,
  BUSINESS_TYPES,
  BUSINESS_TYPE_LABELS,
  NIGERIAN_STATES,
  type PlanId,
} from "@/lib/constants";
import { formatNaira } from "@/lib/money";

/**
 * The plan request form.
 *
 * This is the whole commercial flow: a shop fills this in, it lands in the
 * platform operator's inbox and dashboard, the operator replies with payment
 * instructions, and once the transfer clears they activate the organization.
 * There is no card processing anywhere — an upfront bank transfer is how this
 * market actually pays, so the software models that instead of fighting it.
 *
 * The form is deliberately short. Every extra field measurably costs
 * submissions, so this asks only what is needed to quote and invoice: who they
 * are, how to reach them, and how big they are.
 */

interface FieldErrors {
  [field: string]: string;
}

export function PlanRequestForm({ initialPlan = "BUSINESS" }: { initialPlan?: PlanId }) {
  const [plan, setPlan] = useState<PlanId>(initialPlan);
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "sending") return;

    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());

    setStatus("sending");
    setMessage(null);
    setFieldErrors({});

    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, plan, ...readAttribution() }),
      });
      const body = await response.json();

      if (!response.ok) {
        setStatus("error");
        setFieldErrors(body.fields ?? {});
        setMessage(body.error ?? "We couldn't send that. Please try again.");
        return;
      }

      setStatus("sent");
      setReference(body.reference ?? null);
      form.reset();
    } catch {
      setStatus("error");
      setMessage(
        "We couldn't reach our server. Check your connection and try again — or WhatsApp us directly.",
      );
    }
  }

  if (status === "sent") {
    return (
      <div className="card card-pad text-center animate-slide-up">
        <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-good-50">
          <CheckCircle2 className="size-6 text-good-700" strokeWidth={2.5} />
        </div>
        <h3 className="text-lg font-bold text-ink-950">Request received</h3>
        {reference ? (
          <p className="mt-1 text-sm text-ink-600">
            Your reference is{" "}
            <span className="font-mono font-bold text-brand-700">{reference}</span>
          </p>
        ) : null}
        <p className="mx-auto mt-4 max-w-sm text-sm leading-relaxed text-ink-600">
          We&apos;ve got your details. You&apos;ll receive an email with the payment
          instructions and the total for the{" "}
          <span className="font-semibold text-ink-900">{PLANS[plan].name}</span> plan.
          Once your transfer lands, we activate your account and send your main
          admin login.
        </p>
        <button
          type="button"
          onClick={() => {
            setStatus("idle");
            setReference(null);
          }}
          className="btn btn-outline btn-sm mt-6"
        >
          Send another request
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="card card-pad">
      {/* ── Plan picker ─────────────────────────────────────────────────── */}
      <fieldset className="mb-5">
        <legend className="label mb-2">Which plan?</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {PLAN_ORDER.map((id) => {
            const definition = PLANS[id];
            const selected = plan === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setPlan(id)}
                aria-pressed={selected}
                className={`rounded-xl border p-3 text-left transition-colors ${
                  selected
                    ? "border-brand-700 bg-brand-50"
                    : "border-ink-200 bg-white hover:border-ink-300"
                }`}
              >
                <span className="block text-sm font-bold text-ink-950">
                  {definition.name}
                </span>
                <span className="tabular mt-0.5 block text-xs text-ink-600">
                  {formatNaira(definition.priceKobo)}/yr
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Business name"
          name="companyName"
          required
          autoComplete="organization"
          placeholder="Mama Nkechi Supermarket"
          error={fieldErrors.companyName}
          className="sm:col-span-2"
        />

        <div>
          <label className="label" htmlFor="businessType">
            Type of business
          </label>
          <select id="businessType" name="businessType" className="select" defaultValue="SUPERMARKET">
            {BUSINESS_TYPES.map((type) => (
              <option key={type} value={type}>
                {BUSINESS_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="state">
            State
          </label>
          <select id="state" name="state" className="select" defaultValue="Lagos">
            {NIGERIAN_STATES.map((state) => (
              <option key={state} value={state}>
                {state}
              </option>
            ))}
          </select>
        </div>

        <Field
          label="Your name"
          name="contactName"
          required
          autoComplete="name"
          placeholder="Chinedu Okafor"
          error={fieldErrors.contactName}
        />
        <Field
          label="Your role"
          name="contactRole"
          placeholder="Owner"
          error={fieldErrors.contactRole}
        />

        <Field
          label="Email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          hint="We send the invoice and your login here."
          error={fieldErrors.email}
        />
        <Field
          label="Phone / WhatsApp"
          name="phone"
          type="tel"
          required
          autoComplete="tel"
          placeholder="0803 123 4567"
          error={fieldErrors.phone}
        />

        <Field
          label="How many shops?"
          name="branchCount"
          type="number"
          min={1}
          defaultValue={1}
          error={fieldErrors.branchCount}
        />
        <Field
          label="How many staff?"
          name="staffCount"
          type="number"
          min={1}
          defaultValue={3}
          error={fieldErrors.staffCount}
        />

        <div className="sm:col-span-2">
          <label className="label" htmlFor="notes">
            Anything we should know? <span className="font-normal text-ink-400">(optional)</span>
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={3}
            className="textarea"
            placeholder="We run two shops in Ikeja and sell mostly provisions and drinks. We already have a barcode scanner."
          />
        </div>
      </div>

      {status === "error" && message ? (
        <p
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-xl border border-bad-100 bg-bad-50 p-3 text-sm text-bad-700"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{message}</span>
        </p>
      ) : null}

      <div className="mt-5 flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-relaxed text-ink-500">
          No card needed. We reply with bank details and activate your account
          once payment lands.
        </p>
        <button
          type="submit"
          disabled={status === "sending"}
          className="btn btn-primary btn-lg shrink-0"
        >
          {status === "sending" ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Sending…
            </>
          ) : (
            <>Request {PLANS[plan].name} &mdash; {formatNaira(PLANS[plan].priceKobo)}/yr</>
          )}
        </button>
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function Field({
  label,
  name,
  error,
  hint,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  name: string;
  error?: string;
  hint?: string;
}) {
  const id = `f-${name}`;
  return (
    <div className={className}>
      <label className="label" htmlFor={id}>
        {label}
        {props.required ? <span className="text-brand-700"> *</span> : null}
      </label>
      <input
        id={id}
        name={name}
        className="input"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        {...props}
      />
      {error ? (
        <p id={`${id}-error`} className="error-text">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
