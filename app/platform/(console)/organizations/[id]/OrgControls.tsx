"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  AlertTriangle,
  Ban,
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  MailWarning,
  PlayCircle,
  RefreshCw,
  Wallet,
} from "lucide-react";

import { PLANS, PLAN_ORDER, UNLIMITED, type PlanId } from "@/lib/constants";
import { formatNaira, fromKobo, toKobo } from "@/lib/money";

/**
 * The controls over one live business.
 *
 * Split into four small components rather than one panel, because they carry
 * very different weight. Recording a renewal is routine bookkeeping. Suspending
 * an account stops a shop from selling — possibly mid-queue — so it asks first,
 * in writing, and says what will happen.
 *
 * None of these are optimistic. A button that says "Suspended" before the server
 * agreed is a button that lies during a network blip, and the operator's next
 * move would be to tell the customer something untrue.
 */

function useAction(organizationId: string) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run<T = unknown>(
    key: string,
    body: Record<string, unknown>,
  ): Promise<T | null> {
    if (pending) return null;
    setPending(key);
    setError(null);
    try {
      const response = await fetch(`/api/platform/organizations/${organizationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? "That didn't go through. Please try again.");
        return null;
      }
      router.refresh();
      return payload as T;
    } catch {
      setError("Couldn't reach the server. Nothing was changed.");
      return null;
    } finally {
      setPending(null);
    }
  }

  return { run, pending, error, setError };
}

function ErrorLine({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="mt-3 flex items-start gap-2 rounded-lg border border-bad-200 bg-bad-50 px-3 py-2 text-sm text-bad-700"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      {message}
    </p>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Activate / suspend
// ═════════════════════════════════════════════════════════════════════════════

export function StatusControls({
  organizationId,
  organizationName,
  status,
}: {
  organizationId: string;
  organizationName: string;
  status: string;
}) {
  const { run, pending, error } = useAction(organizationId);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");

  const live = status === "ACTIVE";

  return (
    <div>
      {live ? (
        confirming ? (
          <div className="rounded-xl border border-bad-200 bg-bad-50 p-3">
            <p className="flex items-start gap-2 text-sm font-bold text-bad-700">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              Suspend {organizationName}?
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-700">
              Their till stops taking sales immediately and nobody can sign in
              except to see the renewal screen. If a cashier is mid-sale, they
              lose the cart. Their data is untouched and you can undo this at any
              time.
            </p>
            <label className="label mt-3" htmlFor="suspend-reason">
              Reason <span className="font-normal text-ink-400">(saved to their audit log)</span>
            </label>
            <input
              id="suspend-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Renewal unpaid since 12 March"
              className="input"
            />
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={async () => {
                  const result = await run("suspend", {
                    action: "SUSPEND",
                    reason: reason.trim() || undefined,
                  });
                  if (result) setConfirming(false);
                }}
                disabled={pending !== null}
                className="btn btn-sm bg-bad-700 text-white hover:bg-bad-800"
              >
                {pending === "suspend" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Ban className="size-4" />
                )}
                Yes, suspend them
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={pending !== null}
                className="btn btn-ghost btn-sm"
              >
                Keep them running
              </button>
            </div>
            <ErrorLine message={error} />
          </div>
        ) : (
          <div>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="btn btn-outline btn-sm text-bad-700"
            >
              <Ban className="size-4" />
              Suspend account
            </button>
            <p className="hint">Stops them trading. Reversible, and their data stays put.</p>
          </div>
        )
      ) : (
        <div>
          <button
            type="button"
            onClick={() => run("activate", { action: "ACTIVATE" })}
            disabled={pending !== null}
            className="btn btn-primary btn-sm"
          >
            {pending === "activate" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <PlayCircle className="size-4" />
            )}
            {status === "PENDING" ? "Activate account" : "Restore access"}
          </button>
          <p className="hint">
            {status === "PENDING"
              ? "They can sign in now but cannot sell until this is on."
              : "Puts them straight back to where they were."}
          </p>
          <ErrorLine message={error} />
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Record a renewal
// ═════════════════════════════════════════════════════════════════════════════

export function RenewForm({
  organizationId,
  currentPlan,
  expiresAt,
}: {
  organizationId: string;
  currentPlan: string;
  expiresAt: string | null;
}) {
  const { run, pending, error } = useAction(organizationId);
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<PlanId>(
    PLAN_ORDER.includes(currentPlan as PlanId) ? (currentPlan as PlanId) : "STARTER",
  );
  const [amount, setAmount] = useState(String(fromKobo(PLANS[plan].priceKobo)));
  const [months, setMonths] = useState("12");
  const [reference, setReference] = useState("");
  const [done, setDone] = useState<string | null>(null);

  const lapsed = expiresAt ? new Date(expiresAt).getTime() < Date.now() : true;

  if (done) {
    return (
      <div className="rounded-xl border border-good-200 bg-good-50 p-3">
        <p className="flex items-center gap-2 text-sm font-bold text-good-700">
          <Check className="size-4" strokeWidth={3} />
          Renewal recorded
        </p>
        <p className="mt-1 text-sm text-ink-700">
          Active until{" "}
          {new Date(done).toLocaleDateString("en-NG", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
          . A receipt has gone to their business email.
        </p>
      </div>
    );
  }

  if (!open) {
    return (
      <div>
        <button type="button" onClick={() => setOpen(true)} className="btn btn-dark btn-sm">
          <Wallet className="size-4" />
          Record a payment
        </button>
        <p className="hint">
          {lapsed
            ? "This also reactivates them."
            : "Renewing early adds to the current term — they keep the days they've paid for."}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-ink-200 bg-ink-50 p-3">
      <div className="grid gap-2 sm:grid-cols-3">
        {PLAN_ORDER.map((id) => {
          const selected = plan === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => {
                setPlan(id);
                setAmount(String(fromKobo(PLANS[id].priceKobo)));
              }}
              aria-pressed={selected}
              className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                selected
                  ? "border-brand-700 bg-brand-50 ring-1 ring-brand-700"
                  : "border-ink-200 bg-white hover:border-ink-300"
              }`}
            >
              <span className="block text-xs font-bold text-ink-950">{PLANS[id].name}</span>
              <span className="tabular block text-xs font-semibold text-brand-700">
                {formatNaira(PLANS[id].priceKobo)}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="renew-amount">
            Amount received (₦)
          </label>
          <input
            id="renew-amount"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            className="input"
          />
        </div>
        <div>
          <label className="label" htmlFor="renew-months">
            Extends by
          </label>
          <select
            id="renew-months"
            value={months}
            onChange={(event) => setMonths(event.target.value)}
            className="input"
          >
            <option value="12">12 months</option>
            <option value="24">24 months</option>
            <option value="6">6 months</option>
            <option value="3">3 months</option>
            <option value="1">1 month</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="renew-reference">
            Payment reference <span className="font-normal text-ink-400">(optional)</span>
          </label>
          <input
            id="renew-reference"
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            placeholder="Transfer narration or teller no."
            className="input"
          />
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={async () => {
            const result = await run<{ expiresAt: string }>("renew", {
              action: "RENEW",
              plan,
              durationMonths: Number(months),
              amountKobo: toKobo(amount || "0"),
              amountPaidKobo: toKobo(amount || "0"),
              paymentReference: reference.trim() || undefined,
            });
            if (result) setDone(result.expiresAt);
          }}
          disabled={pending !== null}
          className="btn btn-primary btn-sm"
        >
          {pending === "renew" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Check className="size-4" strokeWidth={3} />
          )}
          Save renewal
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={pending !== null}
          className="btn btn-ghost btn-sm"
        >
          Cancel
        </button>
      </div>
      <ErrorLine message={error} />
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Change plan without taking money
// ═════════════════════════════════════════════════════════════════════════════

export function PlanControl({
  organizationId,
  currentPlan,
}: {
  organizationId: string;
  currentPlan: string;
}) {
  const { run, pending, error } = useAction(organizationId);
  const seatLine = (n: number) => (n === UNLIMITED ? "∞" : String(n));

  return (
    <div>
      <div className="grid gap-2 sm:grid-cols-3">
        {PLAN_ORDER.map((id) => {
          const current = currentPlan === id;
          const seats = PLANS[id].seats;
          return (
            <button
              key={id}
              type="button"
              onClick={() => {
                if (current) return;
                run("plan", { action: "SET_PLAN", plan: id });
              }}
              disabled={pending !== null || current}
              aria-current={current ? "true" : undefined}
              className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                current
                  ? "border-brand-700 bg-brand-50 ring-1 ring-brand-700"
                  : "border-ink-200 bg-white hover:border-ink-300 disabled:opacity-60"
              }`}
            >
              <span className="flex items-center justify-between">
                <span className="text-xs font-bold text-ink-950">{PLANS[id].name}</span>
                {current ? (
                  <span className="text-[0.625rem] font-bold uppercase text-brand-700">
                    Current
                  </span>
                ) : pending === "plan" ? (
                  <Loader2 className="size-3 animate-spin text-ink-400" />
                ) : null}
              </span>
              <span className="mt-0.5 block text-[0.6875rem] text-ink-500">
                {seatLine(seats.mainAdmin)} main · {seatLine(seats.subAdmin)} sub ·{" "}
                {seatLine(seats.cashier)} tills
              </span>
            </button>
          );
        })}
      </div>
      <p className="hint">
        Changes seat limits straight away without touching the expiry date or
        taking payment. A downgrade is refused while they have more staff than the
        new plan allows.
      </p>
      <ErrorLine message={error} />
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// "I can't log in"
// ═════════════════════════════════════════════════════════════════════════════

interface ResetResult {
  tempPassword: string;
  email: string | null;
  emailDelivered: boolean;
}

export function StaffList({
  organizationId,
  users,
}: {
  organizationId: string;
  users: Array<{
    id: string;
    name: string;
    email: string | null;
    role: string;
    isActive: boolean;
    lastLoginAt: string | null;
  }>;
}) {
  const { run, pending, error } = useAction(organizationId);
  const [result, setResult] = useState<(ResetResult & { name: string }) | null>(null);

  if (users.length === 0) {
    return <p className="px-4 py-3 text-sm text-ink-500">No admin logins on this account.</p>;
  }

  return (
    <div>
      {result ? (
        <div className="m-3 rounded-xl border-2 border-brand-700 bg-brand-50 p-3">
          <TempPassword result={result} onDone={() => setResult(null)} />
        </div>
      ) : null}

      <ul className="divide-y divide-hairline">
        {users.map((user) => (
          <li key={user.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink-900">
                {user.name}
                {!user.isActive ? (
                  <span className="ml-2 text-xs font-semibold text-ink-400">deactivated</span>
                ) : null}
              </p>
              <p className="truncate text-xs text-ink-500">
                {user.email ?? "No email"} ·{" "}
                {user.role === "MAIN_ADMIN" ? "Main admin" : "Sub-admin"}
                {user.lastLoginAt
                  ? ` · last in ${new Date(user.lastLoginAt).toLocaleDateString("en-NG", { day: "numeric", month: "short" })}`
                  : " · never signed in"}
              </p>
            </div>
            <button
              type="button"
              onClick={async () => {
                const response = await run<ResetResult>(user.id, {
                  action: "RESET_ADMIN_PASSWORD",
                  userId: user.id,
                });
                if (response) setResult({ ...response, name: user.name });
              }}
              disabled={pending !== null}
              className="btn btn-outline btn-sm shrink-0"
            >
              {pending === user.id ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <KeyRound className="size-4" />
              )}
              Reset password
            </button>
          </li>
        ))}
      </ul>
      {error ? (
        <div className="px-4 pb-3">
          <ErrorLine message={error} />
        </div>
      ) : null}
    </div>
  );
}
function TempPassword({
  result,
  onDone,
}: {
  result: ResetResult & { name: string };
  onDone: () => void;
}) {
  const [revealed, setRevealed] = useState(true);
  const [copied, setCopied] = useState(false);

  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wide text-brand-800">
        New password for {result.name} — shown once
      </p>
      <p className="mt-1 text-xs leading-relaxed text-ink-600">
        Their old password stopped working the moment you pressed the button. We
        do not store this one either, so copy it before you close this.
      </p>

      <div className="mt-2.5 flex items-center gap-2">
        <code className="flex-1 rounded-lg border border-brand-200 bg-white px-3 py-2 font-mono text-base font-bold tracking-wider text-ink-950">
          {revealed ? result.tempPassword : "•".repeat(result.tempPassword.length)}
        </code>
        <button
          type="button"
          onClick={() => setRevealed((value) => !value)}
          className="btn btn-outline btn-icon"
          aria-label={revealed ? "Hide password" : "Show password"}
        >
          {revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(result.tempPassword);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              setRevealed(true);
            }
          }}
          className="btn btn-primary btn-sm"
        >
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

      {result.emailDelivered ? (
        <p className="mt-2 text-xs font-semibold text-good-700">
          Also emailed to {result.email}.
        </p>
      ) : (
        <p className="mt-2 flex items-start gap-1.5 text-xs font-semibold text-warn-700">
          <MailWarning className="mt-0.5 size-3.5 shrink-0" />
          The email did not send — pass this on to {result.email ?? "them"} yourself.
        </p>
      )}

      <button type="button" onClick={onDone} className="btn btn-ghost btn-sm mt-2">
        Done
      </button>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Fix their details
// ═════════════════════════════════════════════════════════════════════════════

export function ContactForm({
  organizationId,
  defaults,
}: {
  organizationId: string;
  defaults: { email: string; phone: string; whatsapp: string };
}) {
  const { run, pending, error } = useAction(organizationId);
  const [saved, setSaved] = useState(false);

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        const data = Object.fromEntries(
          new FormData(event.currentTarget).entries(),
        ) as Record<string, string>;
        const result = await run("contact", { action: "UPDATE_CONTACT", ...data });
        if (result) {
          setSaved(true);
          setTimeout(() => setSaved(false), 2500);
        }
      }}
      className="space-y-3"
    >
      <div>
        <label className="label" htmlFor="org-email">
          Business email
        </label>
        <input
          id="org-email"
          name="email"
          type="email"
          defaultValue={defaults.email}
          className="input"
        />
      </div>
      <div>
        <label className="label" htmlFor="org-phone">
          Phone
        </label>
        <input
          id="org-phone"
          name="phone"
          type="tel"
          defaultValue={defaults.phone}
          className="input"
        />
      </div>
      <div>
        <label className="label" htmlFor="org-whatsapp">
          WhatsApp
        </label>
        <input
          id="org-whatsapp"
          name="whatsapp"
          type="tel"
          defaultValue={defaults.whatsapp}
          className="input"
        />
        <p className="hint">Where their daily sales report goes.</p>
      </div>
      <button type="submit" disabled={pending !== null} className="btn btn-outline btn-sm w-full">
        {pending === "contact" ? (
          <Loader2 className="size-4 animate-spin" />
        ) : saved ? (
          <Check className="size-4" strokeWidth={3} />
        ) : (
          <RefreshCw className="size-4" />
        )}
        {saved ? "Saved" : "Save details"}
      </button>
      <ErrorLine message={error} />
    </form>
  );
}
