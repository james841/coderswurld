"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence } from "motion/react";
import { Ban, Loader2, PencilLine, Plus, Search, Trash2, X } from "lucide-react";

import { m, EASE } from "@/components/motion";
import { formatNaira, parseMoneyInput } from "@/lib/money";
import { useBarcodeScanner } from "../../products/useBarcodeScanner";
import type { PurchaseDetail } from "./PurchaseDetailClient";

/**
 * Correct a purchase that was entered wrongly, or cancel one that should not
 * exist. Admins and managers only. Stock moves by the difference, the supplier
 * balance follows the new total, and the reason is kept in the history.
 */

export interface PickProduct {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  unit: string;
  costPriceKobo: number;
}

interface Line {
  key: string;
  id: string | null;
  productId: string;
  name: string;
  unit: string;
  quantity: string;
  unitCost: string;
  batchNo: string;
  expiryDate: string;
}

const naira = (kobo: number) => (kobo / 100).toFixed(2).replace(/\.00$/, "");
const toKobo = (raw: string) => {
  const n = parseMoneyInput(raw);
  return Number.isNaN(n) ? 0 : Math.round(n * 100);
};
const toQty = (raw: string) => {
  const n = Number(String(raw).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

export function PurchaseActions({
  purchase,
  products,
  suppliers,
}: {
  purchase: PurchaseDetail;
  products: PickProduct[];
  suppliers: { id: string; name: string }[];
}) {
  const [mode, setMode] = useState<"none" | "correct" | "cancel">("none");
  if (purchase.status === "CANCELLED") return null;
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-outline" onClick={() => setMode("correct")}>
          <PencilLine className="size-4" />
          Correct this purchase
        </button>
        {purchase.amountPaidKobo === 0 && (
          <button type="button" className="btn btn-ghost text-bad-700" onClick={() => setMode("cancel")}>
            <Ban className="size-4" />
            Cancel purchase
          </button>
        )}
      </div>
      <AnimatePresence>
        {mode === "correct" && (
          <CorrectSheet
            key="correct"
            purchase={purchase}
            products={products}
            suppliers={suppliers}
            onClose={() => setMode("none")}
          />
        )}
        {mode === "cancel" && <CancelSheet key="cancel" purchase={purchase} onClose={() => setMode("none")} />}
      </AnimatePresence>
    </>
  );
}

function Shell({
  title,
  onClose,
  busy,
  wide,
  children,
  onSubmit,
}: {
  title: string;
  onClose: () => void;
  busy: boolean;
  wide?: boolean;
  children: React.ReactNode;
  onSubmit: (e: React.FormEvent) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);
  return (
    <m.div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/50 sm:items-center sm:p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <m.form
        noValidate
        onSubmit={onSubmit}
        onKeyDown={(e) => {
          // Enter in a box never submits a correction by accident (scanners press it).
          if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") e.preventDefault();
        }}
        initial={{ y: 24, opacity: 0, scale: 0.98 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 16, opacity: 0, scale: 0.98 }}
        transition={{ duration: 0.25, ease: EASE }}
        className={`flex max-h-[94vh] w-full ${wide ? "max-w-4xl" : "max-w-md"} flex-col overflow-hidden rounded-t-2xl bg-surface shadow-xl sm:rounded-2xl`}
      >
        <div className="flex items-center justify-between border-b border-hairline p-4">
          <h2 className="text-base font-bold text-ink-950">{title}</h2>
          <button type="button" onClick={() => !busy && onClose()} className="btn btn-icon text-ink-500" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
        {children}
      </m.form>
    </m.div>
  );
}

function CorrectSheet({
  purchase: p,
  products,
  suppliers,
  onClose,
}: {
  purchase: PurchaseDetail;
  products: PickProduct[];
  suppliers: { id: string; name: string }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [supplierId, setSupplierId] = useState(p.supplier.id);
  const [invoiceNo, setInvoiceNo] = useState(p.invoiceNo ?? "");
  const [purchaseDate, setPurchaseDate] = useState(p.purchaseDate.slice(0, 10));
  const [transport, setTransport] = useState(naira(p.transportKobo));
  const [other, setOther] = useState(naira(p.otherCostKobo));
  const [note, setNote] = useState(p.note ?? "");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<Line[]>(() =>
    p.items.map((it) => ({
      key: it.id,
      id: it.id,
      productId: it.productId ?? "",
      name: it.productName,
      unit: it.unit,
      quantity: String(it.quantity),
      unitCost: naira(it.unitCostKobo),
      batchNo: it.batchNo ?? "",
      expiryDate: it.expiryDate ? it.expiryDate.slice(0, 10) : "",
    })),
  );
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);

  // Keep the supplier list complete even if the current one was deactivated.
  const supplierOptions = useMemo(
    () => (suppliers.some((s) => s.id === p.supplier.id) ? suppliers : [p.supplier, ...suppliers]),
    [suppliers, p.supplier],
  );

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length < 2) return [];
    return products
      .filter((x) => x.name.toLowerCase().includes(q) || x.sku.toLowerCase().includes(q) || x.barcode === q)
      .slice(0, 8);
  }, [search, products]);

  function addProduct(prod: PickProduct) {
    setLines((prev) => [
      ...prev,
      {
        key: `new-${prod.id}-${Date.now()}`,
        id: null,
        productId: prod.id,
        name: prod.name,
        unit: prod.unit,
        quantity: "1",
        unitCost: naira(prod.costPriceKobo),
        batchNo: "",
        expiryDate: "",
      },
    ]);
    setSearch("");
  }

  useBarcodeScanner((code) => {
    const prod = products.find((x) => x.barcode === code);
    if (prod) addProduct(prod);
    else setError(`No product has the barcode ${code}.`);
  });

  const update = (key: string, patch: Partial<Line>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const subtotal = lines.reduce((sum, l) => sum + Math.round(toQty(l.quantity) * toKobo(l.unitCost)), 0);
  const total = subtotal + toKobo(transport) + toKobo(other);
  const balance = total - p.amountPaidKobo;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (reason.trim().length < 3) {
      setReasonError("Say what was wrong, in a few words. The next person reads this.");
      return;
    }
    if (lines.length === 0) {
      setError("Keep at least one item. To remove the whole purchase, cancel it instead.");
      return;
    }
    if (lines.some((l) => toQty(l.quantity) <= 0)) {
      setError("Every item needs a quantity above zero. Use the bin to remove an item.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/purchases/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-cw-confirm": "Purchase corrected" },
        body: JSON.stringify({
          action: "correct",
          reason: reason.trim(),
          supplierId,
          invoiceNo,
          purchaseDate,
          transportKobo: toKobo(transport),
          otherCostKobo: toKobo(other),
          note,
          lines: lines.map((l) => ({
            id: l.id,
            productId: l.productId,
            quantity: toQty(l.quantity),
            unitCostKobo: toKobo(l.unitCost),
            batchNo: l.batchNo,
            expiryDate: l.expiryDate,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Couldn't save the correction.");
        setBusy(false);
        return;
      }
      onClose();
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <Shell title={`Correct ${p.reference}`} onClose={onClose} busy={busy} wide onSubmit={submit}>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <p className="rounded-lg bg-info-50 px-3 py-2 text-sm text-info-700">
          Change what is wrong. Stock moves by the difference only, so sales made since stay as they are.
        </p>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="block">
            <span className="label">Supplier</span>
            <select className="input" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              {supplierOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">Invoice number</span>
            <input className="input" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
          </label>
          <label className="block">
            <span className="label">Date received</span>
            <input type="date" className="input" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
          </label>
        </div>

        <div>
          <h3 className="section-title mb-2">Items</h3>
          <div className="overflow-x-auto rounded-xl border border-hairline">
            <table className="data-table min-w-[720px]">
              <thead>
                <tr>
                  <th>Product</th>
                  <th data-numeric>Quantity</th>
                  <th data-numeric>Unit cost (₦)</th>
                  <th>Batch</th>
                  <th>Expiry</th>
                  <th data-numeric>Line total</th>
                  <th aria-label="Remove" />
                </tr>
              </thead>
              <tbody>
                <AnimatePresence initial={false}>
                  {lines.map((l) => {
                    const original = p.items.find((it) => it.id === l.id);
                    const qtyChanged = original && toQty(l.quantity) !== original.quantity;
                    const costChanged = original && toKobo(l.unitCost) !== original.unitCostKobo;
                    return (
                      <m.tr
                        key={l.key}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className={!l.id ? "bg-good-50" : undefined}
                      >
                        <td>
                          <span className="font-medium text-ink-900">{l.name}</span>
                          {!l.id && <span className="badge badge-good ml-2">New</span>}
                          {original && (qtyChanged || costChanged) && (
                            <span className="block text-xs text-ink-500">
                              Was {original.quantity} at {formatNaira(original.unitCostKobo)}
                            </span>
                          )}
                        </td>
                        <td data-numeric>
                          <input
                            className={`input h-9 w-24 text-right ${qtyChanged ? "border-brand-500" : ""}`}
                            inputMode="decimal"
                            value={l.quantity}
                            onChange={(e) => update(l.key, { quantity: e.target.value })}
                            aria-label={`Quantity of ${l.name}`}
                          />
                        </td>
                        <td data-numeric>
                          <input
                            className={`input h-9 w-28 text-right ${costChanged ? "border-brand-500" : ""}`}
                            inputMode="decimal"
                            value={l.unitCost}
                            onChange={(e) => update(l.key, { unitCost: e.target.value })}
                            aria-label={`Unit cost of ${l.name}`}
                          />
                        </td>
                        <td>
                          <input
                            className="input h-9 w-28"
                            value={l.batchNo}
                            onChange={(e) => update(l.key, { batchNo: e.target.value })}
                            aria-label={`Batch of ${l.name}`}
                          />
                        </td>
                        <td>
                          <input
                            type="date"
                            className="input h-9 w-36"
                            value={l.expiryDate}
                            onChange={(e) => update(l.key, { expiryDate: e.target.value })}
                            aria-label={`Expiry of ${l.name}`}
                          />
                        </td>
                        <td data-numeric className="tabular font-semibold text-ink-900">
                          {formatNaira(Math.round(toQty(l.quantity) * toKobo(l.unitCost)))}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-icon text-ink-400 hover:text-bad-700"
                            onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}
                            aria-label={`Remove ${l.name}`}
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </td>
                      </m.tr>
                    );
                  })}
                </AnimatePresence>
              </tbody>
            </table>
          </div>

          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
            <input
              className="input pl-9"
              placeholder="Add an item that was missed: type a name or scan its barcode"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {matches.length > 0 && (
              <ul className="absolute inset-x-0 top-full z-10 mt-1 max-h-64 overflow-y-auto rounded-xl border border-hairline bg-surface shadow-lg">
                {matches.map((prod) => (
                  <li key={prod.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-ink-50"
                      onClick={() => addProduct(prod)}
                    >
                      <span>
                        <span className="font-medium text-ink-900">{prod.name}</span>
                        <span className="block text-xs text-ink-400">{prod.sku}</span>
                      </span>
                      <Plus className="size-4 text-brand-700" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">Transport (₦)</span>
            <input className="input" inputMode="decimal" value={transport} onChange={(e) => setTransport(e.target.value)} />
          </label>
          <label className="block">
            <span className="label">Other costs (₦)</span>
            <input className="input" inputMode="decimal" value={other} onChange={(e) => setOther(e.target.value)} />
          </label>
        </div>

        <label className="block">
          <span className="label">Note</span>
          <textarea className="input min-h-16" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>

        <div className="grid gap-3 rounded-xl bg-ink-50 p-3 text-sm sm:grid-cols-3">
          <p>
            <span className="block text-ink-500">Total before</span>
            <span className="tabular font-semibold text-ink-900">{formatNaira(p.totalKobo)}</span>
          </p>
          <p>
            <span className="block text-ink-500">Total after</span>
            <span className={`tabular font-bold ${total !== p.totalKobo ? "text-brand-700" : "text-ink-900"}`}>
              {formatNaira(total)}
            </span>
          </p>
          <p>
            <span className="block text-ink-500">Still owing after</span>
            <span className={`tabular font-semibold ${balance < 0 ? "text-bad-700" : "text-ink-900"}`}>
              {balance < 0 ? `Paid ${formatNaira(-balance)} too much` : formatNaira(balance)}
            </span>
          </p>
        </div>

        <label className="block">
          <span className="label">What was wrong? (required)</span>
          <textarea
            className={`input min-h-16 ${reasonError ? "border-bad-500" : ""}`}
            placeholder="e.g. Typed 50 cartons of Peak Milk, we received 5."
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setReasonError(null);
            }}
          />
          {reasonError && <span className="mt-1 block text-sm text-bad-700">{reasonError}</span>}
        </label>

        {error && <p className="rounded-lg border border-bad-200 bg-bad-50 px-3 py-2 text-sm text-bad-700">{error}</p>}
      </div>

      <div className="flex justify-end gap-2 border-t border-hairline p-4">
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
          Close
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          Save correction
        </button>
      </div>
    </Shell>
  );
}

function CancelSheet({ purchase: p, onClose }: { purchase: PurchaseDetail; onClose: () => void }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (reason.trim().length < 3) {
      setError("Say why, in a few words.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/purchases/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-cw-confirm": "Purchase cancelled" },
        body: JSON.stringify({ action: "cancel", reason: reason.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Couldn't cancel this purchase.");
        setBusy(false);
        return;
      }
      onClose();
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <Shell title={`Cancel ${p.reference}?`} onClose={onClose} busy={busy} onSubmit={submit}>
      <div className="space-y-4 p-4">
        <p className="text-sm text-ink-700">
          This takes all {p.items.length} item{p.items.length === 1 ? "" : "s"} back out of stock and clears the{" "}
          {formatNaira(p.balanceKobo)} it says you owe {p.supplier.name}. Use it for a purchase that should not exist,
          like one entered twice. It stays in the list, marked Cancelled.
        </p>
        <label className="block">
          <span className="label">Why? (required)</span>
          <textarea
            className="input min-h-16"
            placeholder="e.g. Entered twice. The real one is PO-000031."
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setError(null);
            }}
          />
        </label>
        {error && <p className="rounded-lg border border-bad-200 bg-bad-50 px-3 py-2 text-sm text-bad-700">{error}</p>}
      </div>
      <div className="flex justify-end gap-2 border-t border-hairline p-4">
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
          Keep it
        </button>
        <button type="submit" className="btn btn-danger" disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          Cancel purchase
        </button>
      </div>
    </Shell>
  );
}
