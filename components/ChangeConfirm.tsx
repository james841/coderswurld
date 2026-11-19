"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import { AlertTriangle, Trash2 } from "lucide-react";

import { EASE, m } from "@/components/motion";

/**
 * Confirmation for changes, in two parts.
 *
 * 1. <ChangeConfirm /> watches the app's own save calls. When a save, edit or
 *    delete succeeds, a small card with a drawn tick pops in the middle of the
 *    screen ("Product updated", "Staff member added") and fades away by itself.
 *    It never blocks the screen and needs no change in any form: it listens to
 *    every POST / PATCH / PUT / DELETE to /api/ that comes back OK.
 *    A request can choose its own words with an `x-cw-confirm` header, or opt
 *    out with `x-cw-confirm: off`.
 *
 * 2. confirmAction() asks before something can't be undone, in a styled dialog
 *    instead of the browser's plain OK / Cancel box. It returns true or false.
 */

// ── What to say for each kind of change ─────────────────────────────────────

/** Calls that aren't the person changing something: sync, tracking, sign-in. */
const QUIET = [
  "/api/track",
  "/api/pos/",
  "/api/auth/",
  "/api/platform/auth/",
  "/api/notifications",
  "/api/leads",
];

const NOUNS: Record<string, string> = {
  products: "Product",
  staff: "Staff member",
  suppliers: "Supplier",
  customers: "Customer",
  expenses: "Expense",
  purchases: "Purchase",
  receipts: "Receipt",
  settings: "Settings",
  stock: "Stock",
  categories: "Category",
  branches: "Branch",
  sales: "Sale",
  reports: "Report",
  leads: "Request",
  organizations: "Business",
  subscriptions: "Subscription",
};

function describe(method: string, path: string): { title: string; kind: "saved" | "deleted" } | null {
  const quiet = QUIET.some((q) => (q.endsWith("/") ? path.startsWith(q) : path === q || path.startsWith(`${q}/`)));
  if (quiet) return null;
  const parts = path.replace(/^\/api\/(platform\/)?/, "").split("/").filter(Boolean);
  const last = parts[parts.length - 1] ?? "";
  const noun = NOUNS[parts[0] ?? ""] ?? "Changes";

  // Named actions first.
  if (last === "void") return { title: "Sale voided", kind: "deleted" };
  if (last === "reset-password") return { title: "Password reset", kind: "saved" };
  if (last === "write-off") return { title: "Batch removed from stock", kind: "deleted" };
  if (last === "import") return { title: "Import finished", kind: "saved" };
  if (last === "adjust") return { title: "Stock updated", kind: "saved" };
  if (last === "receipt-design") return { title: "Receipt design saved", kind: "saved" };
  if (parts[0] === "reports") return { title: "Report sent", kind: "saved" };

  if (method === "DELETE") return { title: `${noun} deleted`, kind: "deleted" };
  if (noun === "Settings") return { title: "Settings saved", kind: "saved" };
  if (method === "POST") return { title: noun === "Changes" ? "Saved" : `${noun} added`, kind: "saved" };
  return { title: noun === "Changes" ? "Changes saved" : `${noun} updated`, kind: "saved" };
}

// ── Bus between fetch, the toast and the dialog ─────────────────────────────

type Shown = { id: number; title: string; kind: "saved" | "deleted" };
const listeners = new Set<(s: Shown) => void>();
let seq = 0;

/** Show the confirmation card yourself (for changes that aren't an /api/ call). */
export function showChangeConfirm(title: string, kind: "saved" | "deleted" = "saved") {
  const s = { id: ++seq, title, kind };
  listeners.forEach((l) => l(s));
}

let patched = false;
function patchFetch() {
  if (patched || typeof window === "undefined") return;
  patched = true;
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await original(input, init);
    try {
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (method === "GET" || method === "HEAD" || !response.ok) return response;
      const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw, window.location.origin);
      if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) return response;

      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      const custom = headers.get("x-cw-confirm");
      if (custom === "off") return response;
      const said = custom ? { title: custom, kind: method === "DELETE" ? ("deleted" as const) : ("saved" as const) } : describe(method, url.pathname);
      if (said) showChangeConfirm(said.title, said.kind);
    } catch {
      // Never let the confirmation get in the way of the real request.
    }
    return response;
  };
}

// ── The card ────────────────────────────────────────────────────────────────

export function ChangeConfirm() {
  const [shown, setShown] = useState<Shown | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    patchFetch();
    const onShow = (s: Shown) => {
      setShown(s);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setShown(null), 1700);
    };
    listeners.add(onShow);
    return () => {
      listeners.delete(onShow);
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  return (
    <>
      <div className="pointer-events-none fixed inset-0 z-[90] flex items-start justify-center pt-[18vh]" aria-live="polite">
        <AnimatePresence>
          {shown ? (
            <m.div
              key={shown.id}
              role="status"
              initial={{ opacity: 0, scale: 0.85, y: 14 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: -8, transition: { duration: 0.2 } }}
              transition={{ type: "spring", stiffness: 420, damping: 30 }}
              className="flex min-w-60 flex-col items-center rounded-3xl bg-surface/95 px-8 py-6 text-center shadow-[0_24px_60px_-12px_rgba(10,20,40,0.35)] ring-1 ring-hairline backdrop-blur"
            >
              {shown.kind === "deleted" ? <DeletedMark /> : <TickMark />}
              <p className="mt-3 text-base font-bold text-ink-950">{shown.title}</p>
              <p className="mt-0.5 text-xs text-ink-500">{shown.kind === "deleted" ? "Removed just now" : "Saved just now"}</p>
            </m.div>
          ) : null}
        </AnimatePresence>
      </div>
      <ConfirmHost />
    </>
  );
}

/** A green circle that pops, then a tick that draws itself. */
function TickMark() {
  return (
    <m.svg viewBox="0 0 52 52" className="size-14" initial="hidden" animate="shown">
      <m.circle
        cx="26"
        cy="26"
        r="24"
        className="fill-good-50 stroke-good-500"
        strokeWidth="2.5"
        variants={{ hidden: { scale: 0.6, opacity: 0 }, shown: { scale: 1, opacity: 1 } }}
        transition={{ duration: 0.35, ease: EASE }}
        style={{ originX: "50%", originY: "50%" }}
      />
      <m.path
        d="M15 27 l7 7 l15 -16"
        fill="none"
        className="stroke-good-700"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
        variants={{ hidden: { pathLength: 0 }, shown: { pathLength: 1 } }}
        transition={{ duration: 0.4, delay: 0.18, ease: EASE }}
      />
    </m.svg>
  );
}

function DeletedMark() {
  return (
    <m.div
      initial={{ scale: 0.6, opacity: 0, rotate: -12 }}
      animate={{ scale: 1, opacity: 1, rotate: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 20 }}
      className="grid size-14 place-items-center rounded-full bg-sell-50 ring-2 ring-sell-100"
    >
      <Trash2 className="size-6 text-sell-700" />
    </m.div>
  );
}

// ── "Are you sure?" dialog ──────────────────────────────────────────────────

interface Ask {
  title: string;
  body?: string;
  confirmLabel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}
let askListener: ((a: Ask) => void) | null = null;

/** Ask before something can't be undone. Resolves true if they confirm. */
export function confirmAction(opts: Omit<Ask, "resolve">): Promise<boolean> {
  return new Promise((resolve) => {
    if (!askListener) {
      // No dialog on this page: fall back to the browser's own.
      resolve(window.confirm(opts.body ? `${opts.title}\n\n${opts.body}` : opts.title));
      return;
    }
    askListener({ ...opts, resolve });
  });
}

function ConfirmHost() {
  const [ask, setAsk] = useState<Ask | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    askListener = (a) => setAsk(a);
    return () => {
      askListener = null;
    };
  }, []);

  useEffect(() => {
    if (!ask) return;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- close is stable for one ask
  }, [ask]);

  function close(ok: boolean) {
    ask?.resolve(ok);
    setAsk(null);
  }

  return (
    <AnimatePresence>
      {ask ? (
        <m.div
          key="confirm"
          className="fixed inset-0 z-[95] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <button type="button" aria-label="Cancel" className="absolute inset-0 bg-ink-950/45 backdrop-blur-[2px]" onClick={() => close(false)} />
          <m.div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            initial={{ opacity: 0, scale: 0.9, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="relative w-full max-w-sm rounded-3xl bg-surface p-6 shadow-2xl"
          >
            <div className={`mx-auto grid size-12 place-items-center rounded-full ${ask.danger ? "bg-sell-50" : "bg-brand-50"}`}>
              {ask.danger ? <Trash2 className="size-6 text-sell-700" /> : <AlertTriangle className="size-6 text-brand-700" />}
            </div>
            <h2 id="confirm-title" className="mt-4 text-center text-lg font-bold text-ink-950">
              {ask.title}
            </h2>
            {ask.body ? <p className="mt-1.5 text-center text-sm text-ink-600">{ask.body}</p> : null}
            <div className="mt-6 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => close(false)} className="btn btn-outline">
                Cancel
              </button>
              <button
                ref={confirmRef}
                type="button"
                onClick={() => close(true)}
                className={ask.danger ? "btn bg-sell-600 text-white hover:bg-sell-700" : "btn btn-primary"}
              >
                {ask.confirmLabel ?? "Yes, continue"}
              </button>
            </div>
          </m.div>
        </m.div>
      ) : null}
    </AnimatePresence>
  );
}
