"use client";

import { useMemo, useState } from "react";
import { printReceipt } from "@/lib/printReceipt";
import { ReceiptSheet } from "@/components/receipt/ReceiptSheet";
import type { ReceiptDesign } from "@/lib/receiptDesign";
import { useRouter } from "next/navigation";
import { Printer, Ban } from "lucide-react";

import { formatNaira } from "@/lib/money";
import {
  PAYMENT_METHOD_LABELS,
  SALE_STATUS_LABELS,
  type PaymentMethod,
  type SaleStatus,
} from "@/lib/constants";

export interface SaleDetail {
  id: string;
  receiptNo: string;
  soldAt: string; // ISO
  status: string;
  priceMode: string;
  paymentMethod: string;
  subtotalKobo: number;
  discountKobo: number;
  taxKobo: number;
  totalKobo: number;
  tenderedKobo: number;
  changeKobo: number;
  paidKobo: number;
  balanceKobo: number;
  note: string | null;
  voidedReason: string | null;
  cashierName: string;
  customer: { id: string; name: string; phone: string | null } | null;
  branch: { name: string; code: string };
  items: {
    id: string;
    productName: string;
    sku: string | null;
    unit: string;
    quantity: number;
    unitPriceKobo: number;
    discountKobo: number;
    lineTotalKobo: number;
    priceType: string;
  }[];
}

type Org = { name: string; phone: string | null; address: string | null; logoUrl: string | null; timezone: string };
type Settings = {
  receiptWidth: "80mm" | "58mm";
  receiptHeader: string | null;
  receiptFooter: string;
  receiptShowLogo: boolean;
  receiptShowCashier: boolean;
};

const methodLabel = (m: string) => PAYMENT_METHOD_LABELS[m as PaymentMethod] ?? m;
const statusLabel = (s: string) => SALE_STATUS_LABELS[s as SaleStatus] ?? s;

export function SaleDetailClient({
  detail,
  org,
  settings,
  canVoid,
  design,
}: {
  design: ReceiptDesign;
  detail: SaleDetail;
  org: Org;
  settings: Settings;
  canVoid: boolean;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const voided = detail.status !== "COMPLETED";

  const stamp = useMemo(
    () =>
      new Intl.DateTimeFormat("en-NG", {
        timeZone: org.timezone,
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(detail.soldAt)),
    [detail.soldAt, org.timezone],
  );

  async function doVoid() {
    if (voiding) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setVoiding(true);
    setError(null);
    try {
      const res = await fetch(`/api/sales/${detail.id}/void`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() || undefined }),
      });
      if (res.ok) {
        router.refresh();
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Couldn't void this sale. Please try again.");
      setVoiding(false);
      setConfirming(false);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
      setVoiding(false);
      setConfirming(false);
    }
  }

  return (
    <div className="space-y-4">
      {voided && (
        <div className="flex items-start gap-3 rounded-xl border border-bad-200 bg-bad-50 p-4">
          <Ban className="mt-0.5 size-5 shrink-0 text-bad-700" />
          <div className="min-w-0">
            <p className="font-semibold text-bad-700">
              This sale was {statusLabel(detail.status).toLowerCase()}
            </p>
            {detail.voidedReason && (
              <p className="mt-0.5 text-sm text-ink-600">{detail.voidedReason}</p>
            )}
            <p className="mt-0.5 text-sm text-ink-500">
              Its stock went back on the shelf and any balance owed was cleared.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)] lg:items-start">
        {/* The artifact: a faithful reprint of the slip */}
        <div>
          <div id="sale-receipt" className="flex justify-center lg:block">
            <div className="w-fit shadow-[0_6px_20px_rgba(10,20,40,0.12)]">
              <ReceiptSheet
                data={{
                  receiptNo: detail.receiptNo,
                  cashierName: detail.cashierName,
                  items: detail.items.map((it) => ({
                    name: it.productName,
                    unit: it.unit,
                    quantity: it.quantity,
                    unitPriceKobo: it.unitPriceKobo,
                    lineTotalKobo: it.lineTotalKobo,
                  })),
                  subtotalKobo: detail.subtotalKobo,
                  discountKobo: detail.discountKobo,
                  taxKobo: detail.taxKobo,
                  totalKobo: detail.totalKobo,
                  paidKobo: detail.paidKobo,
                  balanceKobo: detail.balanceKobo,
                  tenderedKobo: detail.tenderedKobo,
                  changeKobo: detail.changeKobo,
                  paymentMethod: detail.paymentMethod as PaymentMethod,
                  offline: false,
                }}
                org={org}
                branch={detail.branch}
                settings={settings}
                design={design}
                stamp={stamp}
                banner={voided ? statusLabel(detail.status).toUpperCase() : null}
                customerName={detail.customer?.name ?? null}
              />
              <div className="receipt-paper-edge" aria-hidden />
            </div>
          </div>

          <button
            type="button"
            onClick={() => printReceipt(document.querySelector("#sale-receipt .receipt-sheet"))}
            className="btn btn-dark mt-3 w-full"
          >
            <Printer className="size-4" />
            Print receipt
          </button>
        </div>

        {/* The quieter column: the glance figure, the facts, the one dangerous action */}
        <div className="space-y-4">
          <div className="card card-pad">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm text-ink-500">Total</p>
                <p
                  className={`tabular mt-1 text-3xl font-bold tracking-tight ${
                    voided ? "text-ink-400 line-through" : "text-ink-950"
                  }`}
                >
                  {formatNaira(detail.totalKobo)}
                </p>
              </div>
              <StatusBadge status={detail.status} />
            </div>
            {detail.balanceKobo > 0 && !voided && (
              <p className="mt-2 text-sm font-medium text-warn-700">
                {formatNaira(detail.balanceKobo)} still owed
              </p>
            )}
            {detail.changeKobo > 0 && (
              <p className="mt-1 text-sm text-ink-500">
                Change given {formatNaira(detail.changeKobo)}
              </p>
            )}
          </div>

          <dl className="card card-pad divide-y divide-hairline">
            <DRow label="Receipt" value={detail.receiptNo} />
            <DRow label="Date" value={stamp} />
            <DRow label="Served by" value={detail.cashierName} />
            <DRow label="Branch" value={`${detail.branch.name} (${detail.branch.code})`} />
            <DRow label="Payment" value={methodLabel(detail.paymentMethod)} />
            <DRow
              label="Price"
              value={detail.priceMode === "WHOLESALE" ? "Wholesale" : "Retail"}
            />
            <DRow label="Customer" value={detail.customer?.name ?? "Walk-in"} />
            {detail.customer?.phone && <DRow label="Phone" value={detail.customer.phone} />}
            {detail.note && <DRow label="Note" value={detail.note} />}
          </dl>

          {canVoid && (
            <div className="card card-pad">
              <h2 className="text-sm font-semibold text-ink-900">Void this sale</h2>
              <p className="mt-1 text-sm leading-relaxed text-ink-500">
                Puts every item back in stock and clears what the customer owed on it. This can&apos;t
                be undone.
              </p>

              <label className="mt-3 block">
                <span className="mb-1 block text-sm font-semibold text-ink-800">
                  Reason <span className="font-normal text-ink-400">(optional)</span>
                </span>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="input min-h-16 resize-y"
                  placeholder="e.g. rang up the wrong item"
                  maxLength={300}
                  disabled={voiding}
                />
              </label>

              {error && (
                <p className="mt-3 rounded-lg bg-bad-50 px-3 py-2 text-sm text-bad-700">{error}</p>
              )}

              <div className="mt-3 flex items-center justify-end gap-2">
                {confirming && !voiding && (
                  <button
                    type="button"
                    onClick={() => setConfirming(false)}
                    className="btn btn-outline btn-sm"
                  >
                    Keep sale
                  </button>
                )}
                <button
                  type="button"
                  onClick={doVoid}
                  disabled={voiding}
                  className="btn btn-danger btn-sm"
                >
                  <Ban className="size-4" />
                  {voiding ? "Voiding…" : confirming ? "Yes, void sale" : "Void sale"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "COMPLETED"
      ? "badge-good"
      : status === "PARTIAL_REFUND"
        ? "badge-warn"
        : "badge-bad";
  return <span className={`badge ${cls} shrink-0`}>{statusLabel(status)}</span>;
}

function DRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
      <dt className="shrink-0 text-sm text-ink-500">{label}</dt>
      <dd className="min-w-0 break-words text-right text-sm font-medium text-ink-900">{value}</dd>
    </div>
  );
}


