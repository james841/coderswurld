"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Store,
  Phone,
  MessageCircle,
  Calendar,
  FileText,
  MapPin,
  Banknote,
  X,
} from "lucide-react";

import { formatNaira, parseMoneyInput } from "@/lib/money";
import { PRODUCT_UNITS } from "@/lib/constants";
import { PaymentBadge } from "../PurchasesClient";

/**
 * One delivery, read-only — plus the one thing you still do to it: pay down what
 * you owe. Everything else about a purchase is history the moment it's recorded
 * (the stock is already on the shelf), so there's nothing to edit here. The only
 * live figure is the balance, and the only action is settling it.
 */

export interface PurchaseDetail {
  id: string;
  reference: string;
  invoiceNo: string | null;
  purchaseDate: string;
  subtotalKobo: number;
  transportKobo: number;
  otherCostKobo: number;
  totalKobo: number;
  amountPaidKobo: number;
  balanceKobo: number;
  paymentStatus: string;
  status: string;
  note: string | null;
  supplier: { id: string; name: string; phone: string | null; whatsapp: string | null };
  branch: { name: string; code: string };
  multiBranch: boolean;
  items: {
    id: string;
    quantity: number;
    unitCostKobo: number;
    lineTotalKobo: number;
    batchNo: string | null;
    expiryDate: string | null;
    productId: string | null;
    productName: string;
    sku: string | null;
    unit: string;
  }[];
  payments: {
    id: string;
    amountKobo: number;
    method: string;
    reference: string | null;
    paidAt: string;
  }[];
}

const METHOD_LABELS: Record<string, string> = {
  CASH: "Cash",
  TRANSFER: "Bank transfer",
  POS: "Card / POS",
  CHEQUE: "Cheque",
};

export function PurchaseDetailClient({
  purchase: p,
  canPay,
  timezone,
}: {
  purchase: PurchaseDetail;
  canPay: boolean;
  timezone: string;
}) {
  const [paying, setPaying] = useState(false);

  const fmtDate = new Intl.DateTimeFormat("en-NG", {
    timeZone: timezone,
    dateStyle: "medium",
  });
  const fmtQty = new Intl.NumberFormat("en-NG", { maximumFractionDigits: 3 });

  const cancelled = p.status === "CANCELLED";
  const owing = p.balanceKobo > 0 && !cancelled;
  const canSettle = canPay && owing;

  return (
    <div className="space-y-4">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <section className="card card-pad">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-ink-950">{p.reference}</h1>
              {cancelled ? (
                <span className="badge badge-bad">Cancelled</span>
              ) : (
                <PaymentBadge status={p.paymentStatus} balanceKobo={p.balanceKobo} />
              )}
            </div>

            <div className="mt-2 flex items-center gap-2">
              <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-ink-100 text-ink-500">
                <Store className="size-4" />
              </div>
              <p className="truncate font-semibold text-ink-900">{p.supplier.name}</p>
            </div>

            {(p.supplier.phone || p.supplier.whatsapp) && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {p.supplier.phone && (
                  <a href={`tel:${p.supplier.phone}`} className="contact-chip">
                    <Phone className="size-3.5" />
                    {p.supplier.phone}
                  </a>
                )}
                {p.supplier.whatsapp && (
                  <a
                    href={`https://wa.me/${p.supplier.whatsapp.replace(/\D/g, "")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="contact-chip"
                  >
                    <MessageCircle className="size-3.5" />
                    WhatsApp
                  </a>
                )}
              </div>
            )}
          </div>

          {canSettle && (
            <button
              type="button"
              onClick={() => setPaying(true)}
              className="btn btn-primary shrink-0"
            >
              <Banknote className="size-4" />
              Record payment
            </button>
          )}
        </div>

        {/* Meta line — only the facts that exist for this delivery */}
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 border-t border-hairline pt-3 text-sm text-ink-600">
          <span className="inline-flex items-center gap-1.5">
            <Calendar className="size-4 text-ink-400" />
            {fmtDate.format(new Date(p.purchaseDate))}
          </span>
          {p.multiBranch && (
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="size-4 text-ink-400" />
              {p.branch.name} ({p.branch.code})
            </span>
          )}
          {p.invoiceNo && (
            <span className="inline-flex items-center gap-1.5">
              <FileText className="size-4 text-ink-400" />
              Invoice {p.invoiceNo}
            </span>
          )}
        </div>
      </section>

      {/* ── Items ───────────────────────────────────────────────────────────── */}
      <section className="card overflow-hidden">
        <h2 className="section-title border-b border-hairline px-4 py-3">
          Items received
        </h2>

        {/* Desktop table */}
        <div className="hidden sm:block">
          <table className="data-table">
            <thead>
              <tr>
                <th>Product</th>
                <th data-numeric>Quantity</th>
                <th data-numeric>Unit cost</th>
                <th data-numeric>Line total</th>
              </tr>
            </thead>
            <tbody>
              {p.items.map((it) => (
                <tr key={it.id}>
                  <td>
                    <span className="font-medium text-ink-900">{it.productName}</span>
                    {it.sku && <span className="block text-xs text-ink-400">{it.sku}</span>}
                    <BatchLine batchNo={it.batchNo} expiryDate={it.expiryDate} fmtDate={fmtDate} />
                  </td>
                  <td data-numeric className="text-ink-700">
                    {fmtQty.format(it.quantity)}{" "}
                    <span className="text-ink-400">{unitLabel(it.unit)}</span>
                  </td>
                  <td data-numeric className="tabular text-ink-700">
                    {formatNaira(it.unitCostKobo)}
                  </td>
                  <td data-numeric className="tabular font-semibold text-ink-900">
                    {formatNaira(it.lineTotalKobo)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile list */}
        <ul className="divide-y divide-hairline sm:hidden">
          {p.items.map((it) => (
            <li key={it.id} className="p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-ink-900">{it.productName}</p>
                  {it.sku && <p className="text-xs text-ink-400">{it.sku}</p>}
                </div>
                <span className="tabular shrink-0 font-semibold text-ink-900">
                  {formatNaira(it.lineTotalKobo)}
                </span>
              </div>
              <p className="mt-1 text-sm text-ink-500">
                {fmtQty.format(it.quantity)} {unitLabel(it.unit)} × {formatNaira(it.unitCostKobo)}
              </p>
              <BatchLine batchNo={it.batchNo} expiryDate={it.expiryDate} fmtDate={fmtDate} />
            </li>
          ))}
        </ul>
      </section>

      {/* ── Totals ──────────────────────────────────────────────────────────── */}
      <section className="card card-pad">
        <dl className="ml-auto max-w-xs space-y-2 text-sm">
          <Row label="Subtotal" value={formatNaira(p.subtotalKobo)} />
          {p.transportKobo > 0 && <Row label="Transport" value={formatNaira(p.transportKobo)} />}
          {p.otherCostKobo > 0 && (
            <Row label="Other charges" value={formatNaira(p.otherCostKobo)} />
          )}
          <div className="flex items-center justify-between border-t border-hairline pt-2">
            <dt className="font-semibold text-ink-900">Total</dt>
            <dd className="tabular text-base font-bold text-ink-950">
              {formatNaira(p.totalKobo)}
            </dd>
          </div>
          <Row label="Paid" value={formatNaira(p.amountPaidKobo)} muted />
          <div className="flex items-center justify-between">
            <dt className={owing ? "font-semibold text-warn-700" : "text-ink-500"}>
              {owing ? "Still owing" : "Balance"}
            </dt>
            <dd
              className={`tabular font-bold ${owing ? "text-warn-700" : "text-good-700"}`}
            >
              {formatNaira(p.balanceKobo)}
            </dd>
          </div>
        </dl>
      </section>

      {/* ── Payments ────────────────────────────────────────────────────────── */}
      {p.payments.length > 0 && (
        <section className="card overflow-hidden">
          <h2 className="section-title border-b border-hairline px-4 py-3">Payments</h2>
          <ul className="divide-y divide-hairline">
            {p.payments.map((pay) => (
              <li key={pay.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink-900">
                    {METHOD_LABELS[pay.method] ?? pay.method}
                    {pay.reference && (
                      <span className="font-normal text-ink-400"> · {pay.reference}</span>
                    )}
                  </p>
                  <p className="text-xs text-ink-400">{fmtDate.format(new Date(pay.paidAt))}</p>
                </div>
                <span className="tabular shrink-0 font-semibold text-ink-900">
                  {formatNaira(pay.amountKobo)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Note ────────────────────────────────────────────────────────────── */}
      {p.note && (
        <section className="card card-pad">
          <h2 className="section-title mb-2">Note</h2>
          <p className="whitespace-pre-wrap text-sm text-ink-700">{p.note}</p>
        </section>
      )}

      {paying && (
        <PaySheet
          purchaseId={p.id}
          balanceKobo={p.balanceKobo}
          timezone={timezone}
          onClose={() => setPaying(false)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Bits
// ─────────────────────────────────────────────────────────────────────────────

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-ink-500">{label}</dt>
      <dd className={`tabular ${muted ? "text-ink-500" : "text-ink-800"}`}>{value}</dd>
    </div>
  );
}

function BatchLine({
  batchNo,
  expiryDate,
  fmtDate,
}: {
  batchNo: string | null;
  expiryDate: string | null;
  fmtDate: Intl.DateTimeFormat;
}) {
  if (!batchNo && !expiryDate) return null;
  return (
    <span className="mt-0.5 block text-xs text-ink-400">
      {batchNo && <span>Batch {batchNo}</span>}
      {batchNo && expiryDate && " · "}
      {expiryDate && <span>Expires {fmtDate.format(new Date(expiryDate))}</span>}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Record payment
// ─────────────────────────────────────────────────────────────────────────────

function PaySheet({
  purchaseId,
  balanceKobo,
  timezone,
  onClose,
}: {
  purchaseId: string;
  balanceKobo: number;
  timezone: string;
  onClose: () => void;
}) {
  const router = useRouter();

  // Prefill with the full balance — settling the lot is the common case, and it's
  // easier to lower a figure than to type one.
  const [amount, setAmount] = useState(() => String(balanceKobo / 100));
  const [method, setMethod] = useState("CASH");
  const [reference, setReference] = useState("");
  const [paidAt, setPaidAt] = useState(() => todayInTz(timezone));

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const amountRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    requestAnimationFrame(() => amountRef.current?.focus());
  }, []);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !saving) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [saving, onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;

    const amountKobo = kobo(amount);
    if (amountKobo <= 0) {
      setFieldError("Enter how much you paid.");
      return;
    }
    if (amountKobo > balanceKobo) {
      setFieldError("That's more than what's owed.");
      return;
    }

    setSaving(true);
    setError(null);
    setFieldError(null);
    try {
      const res = await fetch(`/api/purchases/${purchaseId}/pay`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amountKobo,
          method,
          reference: reference.trim() || undefined,
          paidAt: paidAt || undefined,
        }),
      });
      if (res.ok) {
        onClose();
        router.refresh();
        return;
      }
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        fields?: Record<string, string>;
      };
      if (data.fields?.amount) setFieldError(data.fields.amount);
      setError(data.error ?? "Couldn't record this payment. Please try again.");
      setSaving(false);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
      setSaving(false);
    }
  }

  const today = todayInTz(timezone);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/50 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <form
        onSubmit={submit}
        className="animate-slide-up flex max-h-[94vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-surface shadow-xl sm:rounded-2xl"
      >
        <div className="flex items-center justify-between border-b border-hairline p-4">
          <h2 className="text-base font-bold text-ink-950">Record payment</h2>
          <button
            type="button"
            onClick={() => !saving && onClose()}
            className="btn btn-icon text-ink-500 hover:text-ink-900"
            aria-label="Close"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <p className="rounded-lg bg-ink-50 px-3 py-2 text-sm text-ink-600">
            Owing <span className="font-semibold text-ink-900">{formatNaira(balanceKobo)}</span>
          </p>

          <label className="block">
            <span className="mb-1 flex items-baseline justify-between">
              <span className="text-sm font-semibold text-ink-800">Amount paid</span>
              <button
                type="button"
                className="text-xs font-semibold text-brand-700 hover:underline"
                onClick={() => {
                  setAmount(String(balanceKobo / 100));
                  setFieldError(null);
                }}
              >
                Pay full
              </button>
            </span>
            <div
              className={`flex h-11 items-center rounded-lg border bg-surface focus-within:ring-3 focus-within:ring-brand-100 ${
                fieldError
                  ? "border-bad-300"
                  : "border-ink-200 focus-within:border-brand-700"
              }`}
            >
              <span className="pl-3 text-sm text-ink-400">₦</span>
              <input
                ref={amountRef}
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  if (fieldError) setFieldError(null);
                }}
                onBlur={() => {
                  const parsed = parseMoneyInput(amount);
                  if (!Number.isNaN(parsed) && parsed > 0) setAmount(String(parsed));
                }}
                className="w-full bg-transparent px-2 text-[0.9375rem] text-ink-900 outline-none"
                inputMode="decimal"
                placeholder="0"
                autoComplete="off"
                aria-invalid={Boolean(fieldError)}
              />
            </div>
            {fieldError && (
              <span className="mt-1 block text-xs font-medium text-bad-700">{fieldError}</span>
            )}
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-ink-800">How you paid</span>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="select"
            >
              {Object.entries(METHOD_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 flex items-baseline justify-between">
              <span className="text-sm font-semibold text-ink-800">Reference</span>
              <span className="text-xs text-ink-400">Optional</span>
            </span>
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="input"
              placeholder="Transfer ref, cheque no."
              maxLength={80}
              autoComplete="off"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-ink-800">Date paid</span>
            <input
              type="date"
              value={paidAt}
              max={today}
              onChange={(e) => setPaidAt(e.target.value)}
              className="input"
            />
          </label>

          {error && (
            <p className="rounded-lg bg-bad-50 px-3 py-2 text-sm text-bad-700">{error}</p>
          )}
        </div>

        <div className="flex gap-2 border-t border-hairline p-4">
          <button
            type="button"
            onClick={() => !saving && onClose()}
            className="btn btn-outline flex-1"
            disabled={saving}
          >
            Cancel
          </button>
          <button type="submit" className="btn btn-primary flex-[2]" disabled={saving}>
            {saving ? "Recording…" : "Record payment"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function unitLabel(value: string): string {
  return PRODUCT_UNITS.find((u) => u.value === value)?.label ?? value;
}

function kobo(raw: string): number {
  const parsed = parseMoneyInput(raw);
  return Number.isNaN(parsed) ? 0 : Math.round(parsed * 100);
}

function todayInTz(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
