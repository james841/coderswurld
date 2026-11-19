"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence } from "motion/react";
import { CheckCircle2, Loader2, Send, XCircle } from "lucide-react";

import { m, EASE } from "@/components/motion";

type Result = { ok: boolean; id: string | null; error: string | null; fix: string | null; from: string };

export function EmailTest({ defaultTo }: { defaultTo: string }) {
  const router = useRouter();
  const [to, setTo] = useState(defaultTo);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [fieldError, setFieldError] = useState("");

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    setFieldError("");
    try {
      const res = await fetch("/api/platform/email/test", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-cw-confirm": "off" },
        body: JSON.stringify({ to }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFieldError(data?.fields?.to ?? data?.error ?? "Could not send the test.");
      } else {
        setResult(data as Result);
        router.refresh();
      }
    } catch {
      setFieldError("No connection. Check your internet and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={send} className="space-y-3">
      <div>
        <label className="label" htmlFor="test-to">
          Send to
        </label>
        <input
          id="test-to"
          type="email"
          className="input"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="you@gmail.com"
          required
        />
        {fieldError && <p className="mt-1 text-sm text-bad-700">{fieldError}</p>}
      </div>
      <button className="btn btn-primary w-full" disabled={busy}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        {busy ? "Sending…" : "Send test email"}
      </button>

      <AnimatePresence mode="wait">
        {result && (
          <m.div
            key={result.ok ? "ok" : "fail"}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: EASE }}
            className={`rounded-xl border p-4 text-sm ${
              result.ok ? "border-good-200 bg-good-50 text-good-700" : "border-bad-100 bg-bad-50 text-bad-700"
            }`}
          >
            <p className="flex items-center gap-2 font-bold">
              {result.ok ? <CheckCircle2 className="size-5" /> : <XCircle className="size-5" />}
              {result.ok ? "Resend accepted it. Check the inbox (and spam)." : "Resend refused it."}
            </p>
            {result.ok && result.id && <p className="mt-1 font-mono text-xs">Resend ID: {result.id}</p>}
            {!result.ok && result.error && <p className="mt-2 font-mono text-xs">{result.error}</p>}
            {result.fix && <p className="mt-2 font-semibold text-ink-800">{result.fix}</p>}
          </m.div>
        )}
      </AnimatePresence>
    </form>
  );
}
