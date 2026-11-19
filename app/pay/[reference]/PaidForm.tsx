"use client";

import { useState } from "react";
import { AnimatePresence } from "motion/react";
import { CheckCircle2, Loader2, Send } from "lucide-react";

import { m } from "@/components/motion";

export function PaidForm({
  reference,
  token,
  defaultAmount,
  contactName,
}: {
  reference: string;
  token: string;
  defaultAmount: string;
  contactName: string;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [senderName, setSenderName] = useState("");
  const [amount, setAmount] = useState(defaultAmount);
  const [paidOn, setPaidOn] = useState(today);
  const [bank, setBank] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const res = await fetch("/api/leads/paid", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reference, token, senderName, amount, paidOn, bank, note }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; fields?: Record<string, string> };
      if (!res.ok) {
        setError(body.error ?? "Couldn't send. Please try again.");
        setFields(body.fields ?? {});
        return;
      }
      setDone(true);
    } catch {
      setError("Couldn't reach us. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AnimatePresence mode="wait" initial={false}>
      {done ? (
        <m.div
          key="done"
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="mt-6 rounded-2xl bg-good-50 p-6 text-center"
        >
          <CheckCircle2 className="mx-auto size-12 text-good-700" />
          <p className="mt-3 text-lg font-bold text-ink-950">Thank you, {contactName.split(" ")[0]}</p>
          <p className="mt-1 text-sm text-ink-600">
            We&apos;ve got your payment notice and emailed you a copy. We&apos;ll confirm the transfer and send your
            login, usually within a few hours on a working day.
          </p>
        </m.div>
      ) : (
        <m.form key="form" onSubmit={submit} className="mt-5 space-y-4" noValidate exit={{ opacity: 0, y: -6 }}>
          <Field label="Name on the transfer" hint="The account the money came from" error={fields.senderName}>
            <input className="input" value={senderName} onChange={(e) => setSenderName(e.target.value)} placeholder="e.g. Adeyemi Stores Ltd" required maxLength={120} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Amount sent (₦)" error={fields.amount}>
              <input className="input tabular" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </Field>
            <Field label="Date paid" error={fields.paidOn}>
              <input className="input" type="date" max={today} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} required />
            </Field>
          </div>
          <Field label="Your bank" hint="Optional" error={fields.bank}>
            <input className="input" value={bank} onChange={(e) => setBank(e.target.value)} placeholder="e.g. GTBank, Opay, Moniepoint" maxLength={80} />
          </Field>
          <Field label="Anything else?" hint="Optional" error={fields.note}>
            <textarea className="input min-h-20 py-2.5" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="e.g. Paid in two transfers" />
          </Field>
          {error ? (
            <p role="alert" className="rounded-xl border border-sell-100 bg-sell-50 px-3 py-2 text-sm font-medium text-sell-700">
              {error}
            </p>
          ) : null}
          <button type="submit" disabled={busy} className="btn btn-primary btn-lg w-full">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            I&apos;ve made the payment
          </button>
        </m.form>
      )}
    </AnimatePresence>
  );
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between text-sm font-semibold text-ink-800">
        {label}
        {hint ? <span className="text-xs font-normal text-ink-500">{hint}</span> : null}
      </span>
      {children}
      {error ? <span className="mt-1 block text-xs font-medium text-sell-700">{error}</span> : null}
    </label>
  );
}
