"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Search,
  ScanLine,
  Trash2,
  Package,
  Banknote,
  Plus,
} from "lucide-react";

import { formatNaira, parseMoneyInput } from "@/lib/money";
import { PRODUCT_UNITS } from "@/lib/constants";
import { useBarcodeScanner } from "../../products/useBarcodeScanner";
import { findByBarcode, useProductSearch, type PickProduct } from "../useProductSearch";

/**
 * Record goods received.
 *
 * This is the busiest moment in the back office that isn't the till: a storekeeper
 * stands over a delivery with a paper invoice and needs the stock booked in before
 * the next customer. So the screen is built for speed, not for looking at —
 *
 *   • The product picker takes a scan OR a typed search. The same hardware gun the
 *     POS uses adds a line here; a shop that scans to sell can scan to receive.
 *   • Every line pre-fills its unit cost from the product's standing cost, because
 *     the price usually hasn't changed and confirming is faster than typing.
 *   • Totals add up live in the bar at the foot, which also carries the one bold
 *     action. Nothing else on the page competes with "Record goods received".
 *
 * The client sends quantities and kobo, never totals — the server recomputes every
 * figure (see app/api/purchases/route.ts). What's here is a convenience and a
 * preview; the money that lands in the ledger is the server's arithmetic alone.
 */

export type { PickProduct };

export interface PickSupplier {
  id: string;
  name: string;
}

export interface PickBranch {
  id: string;
  name: string;
  code: string;
}

const PAYMENT_METHODS: { value: string; label: string }[] = [
  { value: "CASH", label: "Cash" },
  { value: "TRANSFER", label: "Bank transfer" },
  { value: "POS", label: "Card / POS" },
  { value: "CHEQUE", label: "Cheque" },
];

interface LineDraft {
  productId: string;
  name: string;
  sku: string;
  unit: string;
  qty: string;
  unitCost: string; // naira, as typed
  batchNo: string;
  expiryDate: string; // yyyy-mm-dd
  showBatch: boolean;
}

export function NewPurchaseClient({
  suppliers,
  branches,
  products,
  defaultBranchId,
  multiBranch,
  canPay,
  timezone,
  prefill,
}: {
  /** From "What to reorder": supplier, branch and quantities already chosen. */
  prefill?: { supplierId?: string; branchId?: string; items: { productId: string; qty: number }[] };
  suppliers: PickSupplier[];
  branches: PickBranch[];
  products: PickProduct[];
  defaultBranchId: string;
  multiBranch: boolean;
  canPay: boolean;
  timezone: string;
}) {
  const router = useRouter();

  // ── Delivery header ─────────────────────────────────────────────────────────
  const [supplierId, setSupplierId] = useState(
    prefill?.supplierId && suppliers.some((s) => s.id === prefill.supplierId)
      ? prefill.supplierId
      : suppliers.length === 1
        ? suppliers[0].id
        : "",
  );
  const [branchId, setBranchId] = useState(
    prefill?.branchId && branches.some((b) => b.id === prefill.branchId) ? prefill.branchId : defaultBranchId,
  );
  const [invoiceNo, setInvoiceNo] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(() => todayInTz(timezone));
  const [note, setNote] = useState("");

  // ── Lines ─────────────────────────────────────────────────────────────────
  const [lines, setLines] = useState<LineDraft[]>(() =>
    (prefill?.items ?? []).flatMap(({ productId, qty: n }) => {
      const p = products.find((x) => x.id === productId);
      if (!p) return [];
      return [
        {
          productId: p.id,
          name: p.name,
          sku: p.sku,
          unit: p.unit,
          qty: String(n),
          unitCost: p.costPriceKobo > 0 ? String(p.costPriceKobo / 100) : "",
          batchNo: "",
          expiryDate: "",
          showBatch: false,
        },
      ];
    }),
  );

  // ── Extra costs ─────────────────────────────────────────────────────────────
  const [transport, setTransport] = useState("");
  const [other, setOther] = useState("");

  // ── Settlement (only reachable with PURCHASES_PAY) ──────────────────────────
  const [payNow, setPayNow] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("CASH");
  const [payReference, setPayReference] = useState("");

  // The product search box. Declared up here, before useBarcodeScanner below —
  // the scanner's callback clears it on a successful hit, so setQuery has to
  // exist by the time that hook is wired up.
  const [query, setQuery] = useState("");

  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // ── Live money ──────────────────────────────────────────────────────────────
  const lineTotals = useMemo(
    () => lines.map((l) => Math.round(kobo(l.unitCost) * qty(l.qty))),
    [lines],
  );
  const subtotalKobo = lineTotals.reduce((s, v) => s + v, 0);
  const transportKobo = kobo(transport);
  const otherKobo = kobo(other);
  const totalKobo = subtotalKobo + transportKobo + otherKobo;

  // ── Product lookup: on the server, so a huge catalogue never loads here ───

  function addProduct(p: PickProduct) {
    setLines((prev) => {
      const existing = prev.find((l) => l.productId === p.id);
      if (existing) {
        // Same item scanned twice is one more of it, not a second row.
        return prev.map((l) =>
          l.productId === p.id ? { ...l, qty: String((qty(l.qty) || 0) + 1) } : l,
        );
      }
      return [
        ...prev,
        {
          productId: p.id,
          name: p.name,
          sku: p.sku,
          unit: p.unit,
          qty: "1",
          unitCost: p.costPriceKobo > 0 ? String(p.costPriceKobo / 100) : "",
          batchNo: "",
          expiryDate: "",
          showBatch: false,
        },
      ];
    });
    setProblem(null);
  }

  function updateLine(productId: string, patch: Partial<LineDraft>) {
    setLines((prev) =>
      prev.map((l) => (l.productId === productId ? { ...l, ...patch } : l)),
    );
  }

  function removeLine(productId: string) {
    setLines((prev) => prev.filter((l) => l.productId !== productId));
  }

  // ── Scanning ─────────────────────────────────────────────────────────────
  // A scan is the fastest way to add a line; the gun just types the code and
  // hits Enter. If the code is on file we add it, otherwise we say so briefly
  // rather than silently doing nothing (which reads as "the scanner is broken").
  const [scanNote, setScanNote] = useState<string | null>(null);
  const scanTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function flash(message: string) {
    setScanNote(message);
    if (scanTimer.current) clearTimeout(scanTimer.current);
    scanTimer.current = setTimeout(() => setScanNote(null), 2600);
  }
  useEffect(() => () => {
    if (scanTimer.current) clearTimeout(scanTimer.current);
  }, []);

  useBarcodeScanner(async (code) => {
    const found = await findByBarcode(code);
    if (found) {
      addProduct(found);
      flash(`Added ${found.name}`);
      setQuery("");
    } else {
      flash(`No product has barcode ${code}. Add it to a product first.`);
    }
  });

  // ── Search box ──────────────────────────────────────────────────────────────
  const { results } = useProductSearch(query);

  function setField<K extends string>(key: K, patch: () => void) {
    patch();
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  async function submit() {
    setProblem(null);
    const errors: Record<string, string> = {};

    if (!supplierId) errors.supplier = "Choose who you bought from.";
    if (multiBranch && !branchId) errors.branch = "Pick the receiving branch.";
    if (lines.length === 0) {
      setProblem("Add at least one item to receive.");
    }

    const badLine = lines.find((l) => qty(l.qty) <= 0);
    if (badLine) {
      setProblem(`Set a quantity for ${badLine.name}.`);
    }

    const payKobo = payNow ? kobo(payAmount) : 0;
    if (payNow) {
      if (payKobo <= 0) errors.amountPaid = "Enter how much you paid.";
      else if (payKobo > totalKobo) errors.amountPaid = "More than the total.";
    }

    if (Object.keys(errors).length > 0 || lines.length === 0 || badLine) {
      setFieldErrors(errors);
      return;
    }

    const payload = {
      supplierId,
      branchId: multiBranch ? branchId : undefined,
      invoiceNo: invoiceNo.trim() || undefined,
      purchaseDate: purchaseDate || undefined,
      transportKobo,
      otherCostKobo: otherKobo,
      note: note.trim() || undefined,
      amountPaidKobo: payKobo,
      paymentMethod: payMethod,
      paymentReference: payReference.trim() || undefined,
      lines: lines.map((l) => ({
        productId: l.productId,
        quantity: qty(l.qty),
        unitCostKobo: kobo(l.unitCost),
        batchNo: l.batchNo.trim() || undefined,
        expiryDate: l.expiryDate || undefined,
      })),
    };

    setSaving(true);
    try {
      const res = await fetch("/api/purchases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        router.push("/purchases");
        router.refresh();
        return;
      }
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        fields?: Record<string, string>;
      };
      if (data.fields) setFieldErrors(data.fields);
      setProblem(data.error ?? "Couldn't record this delivery. Please try again.");
      setSaving(false);
    } catch {
      setProblem("Couldn't reach the server. Check your connection and try again.");
      setSaving(false);
    }
  }

  const today = todayInTz(timezone);

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="pb-24"
    >
      {problem && (
        <div className="card mb-4 border-bad-200 bg-bad-50 px-4 py-3 text-sm text-bad-700">
          {problem}
        </div>
      )}

      <div className="space-y-4">
        {/* ── Who & when ───────────────────────────────────────────────────── */}
        <section className="card card-pad">
          <h2 className="section-title mb-3">Delivery</h2>

          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label="Supplier" error={fieldErrors.supplier}>
              <select
                className="select"
                value={supplierId}
                onChange={(e) => setField("supplier", () => setSupplierId(e.target.value))}
                aria-invalid={Boolean(fieldErrors.supplier)}
              >
                <option value="">Choose a supplier…</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>

            {multiBranch && (
              <Field label="Receiving branch" error={fieldErrors.branch}>
                <select
                  className="select"
                  value={branchId}
                  onChange={(e) => setField("branch", () => setBranchId(e.target.value))}
                  aria-invalid={Boolean(fieldErrors.branch)}
                >
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.code})
                    </option>
                  ))}
                </select>
              </Field>
            )}

            <Field
              label="Invoice / waybill no."
              hint="Optional — the supplier's own reference."
            >
              <input
                className="input"
                value={invoiceNo}
                onChange={(e) => setInvoiceNo(e.target.value)}
                placeholder="e.g. INV-4821"
                maxLength={60}
                autoComplete="off"
              />
            </Field>

            <Field label="Date received">
              <input
                type="date"
                className="input"
                value={purchaseDate}
                max={today}
                onChange={(e) => setPurchaseDate(e.target.value)}
              />
            </Field>
          </div>
        </section>

        {/* ── The items (the hero) ─────────────────────────────────────────── */}
        <section className="card card-pad">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="section-title">Items received</h2>
            {lines.length > 0 && (
              <span className="text-xs text-ink-500">
                {lines.length} line{lines.length === 1 ? "" : "s"}
              </span>
            )}
          </div>

          <ProductSearch
            query={query}
            onQuery={setQuery}
            results={results}
            onPick={(p) => {
              addProduct(p);
              setQuery("");
            }}
            scanNote={scanNote}
          />

          {lines.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-ink-200 px-4 py-8 text-center">
              <Package className="mx-auto size-6 text-ink-300" />
              <p className="mt-2 text-sm text-ink-500">
                Scan a barcode, or search above, to add what arrived.
              </p>
            </div>
          ) : (
            <ul className="mt-3 divide-y divide-hairline">
              {lines.map((l, i) => (
                <LineRow
                  key={l.productId}
                  line={l}
                  lineTotalKobo={lineTotals[i]}
                  onChange={(patch) => updateLine(l.productId, patch)}
                  onRemove={() => removeLine(l.productId)}
                />
              ))}
            </ul>
          )}
        </section>

        {/* ── Extra costs ──────────────────────────────────────────────────── */}
        <section className="card card-pad">
          <h2 className="section-title mb-1">Extra costs</h2>
          <p className="mb-3 text-sm text-ink-500">
            Transport and other charges spread across this delivery. Leave blank
            if there were none.
          </p>
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label="Transport">
              <MoneyInput value={transport} onChange={setTransport} />
            </Field>
            <Field label="Other charges">
              <MoneyInput value={other} onChange={setOther} />
            </Field>
          </div>
        </section>

        {/* ── Payment ──────────────────────────────────────────────────────── */}
        {canPay ? (
          <section className="card card-pad">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-brand-700"
                checked={payNow}
                onChange={(e) => {
                  const on = e.target.checked;
                  setPayNow(on);
                  // Default to settling the lot — the common case is paying the
                  // market trader on the spot. They can lower it if they part-paid.
                  if (on && !payAmount) setPayAmount(String(totalKobo / 100));
                  if (!on) setFieldErrors((p) => omit(p, "amountPaid"));
                }}
              />
              <span>
                <span className="flex items-center gap-2 text-sm font-semibold text-ink-800">
                  <Banknote className="size-4 text-ink-400" />
                  I paid for this now
                </span>
                <span className="mt-0.5 block text-sm text-ink-500">
                  Leave this off if you bought on credit — you can pay the supplier
                  later from the delivery&apos;s page.
                </span>
              </span>
            </label>

            {payNow && (
              <div className="mt-4 grid gap-3.5 sm:grid-cols-2">
                <Field label="Amount paid" error={fieldErrors.amountPaid}>
                  <div className="flex items-center gap-2">
                    <MoneyInput
                      value={payAmount}
                      onChange={(v) => setField("amountPaid", () => setPayAmount(v))}
                      invalid={Boolean(fieldErrors.amountPaid)}
                    />
                    <button
                      type="button"
                      className="btn btn-outline btn-sm shrink-0"
                      onClick={() =>
                        setField("amountPaid", () =>
                          setPayAmount(String(totalKobo / 100)),
                        )
                      }
                    >
                      Pay full
                    </button>
                  </div>
                </Field>

                <Field label="How you paid">
                  <select
                    className="select"
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value)}
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field
                  label="Payment reference"
                  hint="Optional — transfer ref, cheque no."
                  className="sm:col-span-2"
                >
                  <input
                    className="input"
                    value={payReference}
                    onChange={(e) => setPayReference(e.target.value)}
                    placeholder="Optional"
                    maxLength={80}
                    autoComplete="off"
                  />
                </Field>
              </div>
            )}
          </section>
        ) : null}

        {/* ── Note ─────────────────────────────────────────────────────────── */}
        <section className="card card-pad">
          <Field label="Note" hint="Anything worth remembering about this delivery.">
            <textarea
              className="textarea"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Two cartons dented, agreed discount."
              maxLength={2000}
            />
          </Field>
        </section>
      </div>

      {/* ── Action bar ───────────────────────────────────────────────────── */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-hairline bg-surface/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs text-ink-500">Total</p>
            <p className="tabular text-xl font-bold tracking-tight text-ink-950">
              {formatNaira(totalKobo)}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/purchases" className="btn btn-ghost">
              Cancel
            </Link>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={saving || lines.length === 0}
            >
              {saving ? "Recording…" : "Record goods received"}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Product search
// ─────────────────────────────────────────────────────────────────────────────

function ProductSearch({
  query,
  onQuery,
  results,
  onPick,
  scanNote,
}: {
  query: string;
  onQuery: (v: string) => void;
  results: PickProduct[];
  onPick: (p: PickProduct) => void;
  scanNote: string | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
        <input
          value={query}
          onChange={(e) => {
            onQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (results[0]) {
                onPick(results[0]);
                setOpen(false);
              }
            }
            if (e.key === "Escape") onQuery("");
          }}
          placeholder="Scan a barcode, or search by name, SKU or code"
          className="input h-11 w-full pl-9 pr-9"
          aria-label="Add a product to this delivery"
          autoComplete="off"
        />
        <ScanLine className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-300" />
      </div>

      {scanNote && (
        <p className="mt-1.5 text-xs font-medium text-brand-700">{scanNote}</p>
      )}

      {open && results.length > 0 && (
        <ul className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-hairline bg-surface py-1 shadow-lg">
          {results.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                // onMouseDown, not onClick — fires before the input's onBlur
                // closes the list and swallows the pick.
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPick(p);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-ink-50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink-900">
                    {p.name}
                  </span>
                  <span className="block truncate text-xs text-ink-400">
                    {p.sku}
                    {p.barcode ? ` · ${p.barcode}` : ""}
                  </span>
                </span>
                {p.costPriceKobo > 0 && (
                  <span className="tabular shrink-0 text-xs text-ink-500">
                    {formatNaira(p.costPriceKobo)}
                  </span>
                )}
                <Plus className="size-4 shrink-0 text-ink-300" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// One line
// ─────────────────────────────────────────────────────────────────────────────

function LineRow({
  line,
  lineTotalKobo,
  onChange,
  onRemove,
}: {
  line: LineDraft;
  lineTotalKobo: number;
  onChange: (patch: Partial<LineDraft>) => void;
  onRemove: () => void;
}) {
  return (
    <li className="py-3 first:pt-0">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink-900">{line.name}</p>
          <p className="truncate text-xs text-ink-400">{line.sku}</p>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="btn btn-icon btn-sm text-ink-400 hover:text-bad-700"
          aria-label={`Remove ${line.name}`}
        >
          <Trash2 className="size-4" />
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-end gap-3">
        <label className="w-24">
          <span className="mb-1 block text-xs text-ink-500">Quantity</span>
          <input
            className="input h-10"
            value={line.qty}
            onChange={(e) => onChange({ qty: e.target.value })}
            inputMode="decimal"
            placeholder="0"
            autoComplete="off"
          />
        </label>

        <span className="pb-2.5 text-ink-300">×</span>

        <label className="w-36">
          <span className="mb-1 block text-xs text-ink-500">Unit cost</span>
          <MoneyInput
            value={line.unitCost}
            onChange={(v) => onChange({ unitCost: v })}
            height="h-10"
          />
        </label>

        <div className="ml-auto pb-1 text-right">
          <span className="block text-xs text-ink-500">Line total</span>
          <span className="tabular text-sm font-semibold text-ink-900">
            {formatNaira(lineTotalKobo)}
          </span>
        </div>
      </div>

      {line.showBatch ? (
        <div className="mt-2.5 grid gap-3 sm:grid-cols-2">
          <label>
            <span className="mb-1 block text-xs text-ink-500">Batch no.</span>
            <input
              className="input h-10"
              value={line.batchNo}
              onChange={(e) => onChange({ batchNo: e.target.value })}
              maxLength={60}
              autoComplete="off"
            />
          </label>
          <label>
            <span className="mb-1 block text-xs text-ink-500">Expiry date</span>
            <input
              type="date"
              className="input h-10"
              value={line.expiryDate}
              onChange={(e) => onChange({ expiryDate: e.target.value })}
            />
          </label>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onChange({ showBatch: true })}
          className="mt-2 text-xs font-semibold text-ink-500 underline-offset-2 hover:text-ink-800 hover:underline"
        >
          + Add batch / expiry
        </button>
      )}
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Small primitives (kept local, matching the house pattern in ProductForm)
// ─────────────────────────────────────────────────────────────────────────────

function Field({
  label,
  hint,
  error,
  className,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label className="label">{label}</label>
      {children}
      {error ? (
        <p className="error-text">{error}</p>
      ) : hint ? (
        <p className="hint">{hint}</p>
      ) : null}
    </div>
  );
}

/** A price field that keeps what was typed and tidies it on the way out. */
function MoneyInput({
  value,
  onChange,
  invalid,
  height = "h-11",
}: {
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  height?: string;
}) {
  return (
    <div
      className={`flex items-center rounded-lg border bg-surface focus-within:ring-3 focus-within:ring-brand-100 ${
        invalid ? "border-bad-300" : "border-ink-200 focus-within:border-brand-700"
      } ${height}`}
    >
      <span className="pl-3 text-sm text-ink-400">₦</span>
      <input
        className="w-full bg-transparent px-2 text-[0.9375rem] text-ink-900 outline-none"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          const parsed = parseMoneyInput(value);
          if (!Number.isNaN(parsed) && parsed > 0) onChange(String(parsed));
        }}
        placeholder="0"
        inputMode="decimal"
        autoComplete="off"
        aria-invalid={invalid || undefined}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Naira text → integer kobo. 0 for anything unparseable. */
function kobo(raw: string): number {
  const parsed = parseMoneyInput(raw);
  return Number.isNaN(parsed) ? 0 : Math.round(parsed * 100);
}

/** Quantity text → positive number, or 0. */
function qty(raw: string): number {
  const n = Number(String(raw).replace(/,/g, "").trim());
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function omit<T extends Record<string, string>>(obj: T, key: string): T {
  if (!obj[key]) return obj;
  const next = { ...obj };
  delete next[key];
  return next;
}

/** Today as yyyy-mm-dd in the shop's timezone (en-CA renders ISO order). */
function todayInTz(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// Unit label kept available for future per-line unit display.
export function unitLabel(value: string): string {
  return PRODUCT_UNITS.find((u) => u.value === value)?.label ?? value;
}
