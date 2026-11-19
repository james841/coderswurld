"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Check,
  FileText,
  Loader2,
  Mail,
  Send,
  Undo2,
  Wallet,
  XCircle,
} from "lucide-react";

/**
 * The pipeline controls.
 *
 * One row of buttons, each one a single click that both records the status and
 * stamps the date. The operator is doing this while reading an email thread —
 * anything that needs a form to be opened, filled and submitted gets skipped,
 * and then the console stops reflecting reality, which makes the whole dashboard
 * worthless.
 *
 * "Send invoice" is the exception that does two things at once, because marking
 * a lead INVOICED without actually invoicing them is the single easiest way to
 * lose a sale.
 */

type Status = "NEW" | "CONTACTED" | "INVOICED" | "CLAIMED" | "PAID" | "REJECTED";

export function LeadPipeline({
  leadId,
  status,
  hasBankDetails,
}: {
  leadId: string;
  status: string;
  hasBankDetails: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sentInvoice, setSentInvoice] = useState(false);

  async function patch(key: string, body: Record<string, unknown>) {
    if (pending) return;
    setPending(key);
    setError(null);
    try {
      const response = await fetch(`/api/platform/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? "That didn't save. Please try again.");
        return;
      }
      if (body.sendInvoiceEmail) {
        if (payload.emailed === false) {
          setError(`The status saved, but the email didn't send: ${payload.emailError ?? "check RESEND_API_KEY and MAIL_FROM"}.`);
        } else setSentInvoice(true);
      }
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Check your connection.");
    } finally {
      setPending(null);
    }
  }

  const is = (value: Status) => status === value;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {!is("CONTACTED") && !is("PAID") ? (
          <button
            type="button"
            onClick={() => patch("contacted", { status: "CONTACTED" })}
            disabled={pending !== null}
            className="btn btn-outline btn-sm"
          >
            {pending === "contacted" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Mail className="size-4" />
            )}
            Mark contacted
          </button>
        ) : null}

        {!is("PAID") ? (
          <button
            type="button"
            onClick={() =>
              patch("invoice", { status: "INVOICED", sendInvoiceEmail: true })
            }
            disabled={pending !== null}
            className="btn btn-primary btn-sm"
          >
            {pending === "invoice" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
            {is("INVOICED") || is("CLAIMED") ? "Resend payment details" : "Send payment details"}
          </button>
        ) : null}

        {!is("INVOICED") && !is("PAID") && !is("CLAIMED") ? (
          <button
            type="button"
            onClick={() => patch("invoiced-quiet", { status: "INVOICED" })}
            disabled={pending !== null}
            className="btn btn-ghost btn-sm"
          >
            {pending === "invoiced-quiet" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <FileText className="size-4" />
            )}
            Mark invoiced only
          </button>
        ) : null}

        {!is("PAID") ? (
          <button
            type="button"
            onClick={() => patch("paid", { status: "PAID" })}
            disabled={pending !== null}
            className={is("CLAIMED") ? "btn btn-primary btn-sm" : "btn btn-dark btn-sm"}
          >
            {pending === "paid" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Wallet className="size-4" />
            )}
            {is("CLAIMED") ? "Confirm payment received" : "Payment received"}
          </button>
        ) : null}

        {is("REJECTED") ? (
          <button
            type="button"
            onClick={() => patch("reopen", { status: "NEW" })}
            disabled={pending !== null}
            className="btn btn-outline btn-sm"
          >
            {pending === "reopen" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Undo2 className="size-4" />
            )}
            Reopen
          </button>
        ) : (
          <button
            type="button"
            onClick={() => patch("reject", { status: "REJECTED" })}
            disabled={pending !== null}
            className="btn btn-ghost btn-sm text-bad-700"
          >
            {pending === "reject" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <XCircle className="size-4" />
            )}
            Not proceeding
          </button>
        )}
      </div>

      {sentInvoice ? (
        <p className="flex items-center gap-2 text-xs font-semibold text-good-700">
          <Check className="size-3.5" strokeWidth={3} />
          Invoice email sent.
        </p>
      ) : null}

      {!hasBankDetails ? (
        <p className="hint">
          No bank details configured, so the invoice email asks them to reply for
          them. Set <code className="font-mono">PAYMENT_BANK_NAME</code>,{" "}
          <code className="font-mono">PAYMENT_ACCOUNT_NAME</code> and{" "}
          <code className="font-mono">PAYMENT_ACCOUNT_NUMBER</code> to include
          them automatically.
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-bad-200 bg-bad-50 px-3 py-2 text-sm text-bad-700"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * The internal notes box.
 *
 * Saves on blur as well as on click, because the operator's next action after
 * typing a note is usually to click a status button, and losing what they typed
 * because they never pressed Save would train them to stop writing notes.
 */
export function LeadNotes({ leadId, initial }: { leadId: string; initial: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState<string>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = value !== saved;

  async function save() {
    if (busy || !dirty) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/platform/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: value }),
      });
      if (!response.ok) {
        const payload = await response.json();
        setError(payload.error ?? "That note didn't save.");
        return;
      }
      setSaved(value);
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Your text is still here. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={save}
        rows={4}
        placeholder="Spoke to the owner on Tuesday. Wants to see the POS before paying…"
        className="input resize-y text-sm"
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="text-xs text-ink-400">
          {busy ? "Saving…" : dirty ? "Unsaved" : "Saved"}
        </p>
        <button
          type="button"
          onClick={save}
          disabled={busy || !dirty}
          className="btn btn-outline btn-sm"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          Save note
        </button>
      </div>
      {error ? (
        <p role="alert" className="error-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}
