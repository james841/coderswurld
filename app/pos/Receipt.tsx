"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, MessageCircle, Plus, Printer, Send, X } from "lucide-react";

import { ReceiptSheet, type ReceiptSheetData } from "@/components/receipt/ReceiptSheet";
import { formatNaira } from "@/lib/money";
import { PAYMENT_METHOD_LABELS } from "@/lib/constants";
import { receiptPhones, type ReceiptDesign, type ReceiptWidth } from "@/lib/receiptDesign";
import { printReceipt } from "@/lib/printReceipt";

/** The receipt on screen in this dialog. */
const sheetEl = () => document.querySelector<HTMLElement>(".print-root .receipt-sheet");

export interface ReceiptData extends ReceiptSheetData {
  soldAt: string;
}

/**
 * After a sale: what the cashier needs at a glance (paid, change to give back),
 * the receipt exactly as it will print, and three ways on: print, WhatsApp,
 * or straight to the next customer.
 *
 * Keys: Enter = new sale, P = print, W = WhatsApp, Esc = close.
 */
export default function Receipt({
  data,
  org,
  branch,
  settings,
  design,
  onClose,
}: {
  data: ReceiptData;
  org: { name: string; timezone: string; phone: string | null; address?: string | null; logoUrl: string | null };
  branch: { name: string; code: string };
  settings: {
    receiptWidth: ReceiptWidth;
    receiptHeader: string | null;
    receiptFooter: string;
    receiptShowLogo: boolean;
    receiptShowCashier: boolean;
    receiptAutoPrint: boolean;
  };
  design: ReceiptDesign;
  onClose: () => void;
}) {
  // Auto-print once, if the shop runs that way. A small delay lets the sheet
  // paint before the print dialog grabs it.
  useEffect(() => {
    if (!settings.receiptAutoPrint) return;
    const id = window.setTimeout(() => void printReceipt(sheetEl()), 300);
    return () => window.clearTimeout(id);
  }, [settings.receiptAutoPrint]);

  const stamp = useMemo(
    () =>
      new Intl.DateTimeFormat("en-NG", {
        timeZone: org.timezone,
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(data.soldAt)),
    [data.soldAt, org.timezone],
  );

  const [waOpen, setWaOpen] = useState(false);
  const [waPhone, setWaPhone] = useState("");
  const [waError, setWaError] = useState<string | null>(null);
  const waRef = useRef<HTMLInputElement>(null);

  function openWhatsApp() {
    setWaOpen(true);
    requestAnimationFrame(() => waRef.current?.focus());
  }

  function sendWhatsApp() {
    const number = toWhatsAppNumber(waPhone);
    if (!number) {
      setWaError("That number doesn't look right. Use 0803 123 4567 or +234 803 123 4567.");
      return;
    }
    const text = receiptText(data, org, branch, settings, design, stamp);
    // wa.me opens WhatsApp Desktop or WhatsApp Web on a computer, and the app on a phone.
    window.open(`https://wa.me/${number}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  }

  // Keyboard: quick hands at a busy counter.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const typing = (e.target as HTMLElement)?.tagName === "INPUT";
      if (e.key === "Escape") onClose();
      else if (typing) return;
      else if (e.key === "Enter") {
        e.preventDefault();
        onClose();
      } else if (e.key.toLowerCase() === "p") void printReceipt(sheetEl());
      else if (e.key.toLowerCase() === "w") openWhatsApp();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const onCredit = data.balanceKobo > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-950/60 p-3 backdrop-blur-[2px] sm:p-6">
      <div className={`flex max-h-[calc(100dvh-1.5rem)] w-full ${
          settings.receiptWidth === "A4" ? "max-w-3xl" : "max-w-md"
        } flex-col overflow-hidden rounded-3xl bg-white shadow-2xl sm:max-h-[calc(100dvh-3rem)]`}>
        {/* ── Outcome ─────────────────────────────────────────────────── */}
        <div className={`texture-waves relative px-5 pb-5 pt-4 text-white ${onCredit ? "bg-brand-700" : "bg-good-700"}`}>
          <button
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3 rounded-full p-1.5 text-white/80 transition hover:bg-white/15 hover:text-white"
            aria-label="Close receipt"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
          <div className="flex items-center gap-2 text-sm font-semibold text-white/90">
            <CheckCircle2 className="h-5 w-5" aria-hidden />
            {onCredit ? "Sale saved, part on credit" : "Sale complete"}
            {data.offline ? <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs">Saved offline</span> : null}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-white/70">Total</p>
              <p className="tabular text-2xl font-bold">{formatNaira(data.totalKobo)}</p>
              <p className="text-xs text-white/75">{PAYMENT_METHOD_LABELS[data.paymentMethod]}</p>
            </div>
            {data.changeKobo > 0 ? (
              <div className="rounded-2xl bg-white px-3 py-2 text-ink-950">
                <p className="text-xs font-bold uppercase tracking-wider text-good-700">Give change</p>
                <p className="tabular text-2xl font-black">{formatNaira(data.changeKobo)}</p>
              </div>
            ) : onCredit ? (
              <div className="rounded-2xl bg-white px-3 py-2 text-ink-950">
                <p className="text-xs font-bold uppercase tracking-wider text-brand-700">Still owed</p>
                <p className="tabular text-2xl font-black">{formatNaira(data.balanceKobo)}</p>
              </div>
            ) : null}
          </div>
        </div>

        {/* ── The receipt, as it will print ───────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-y-auto bg-ink-100 px-4 py-5">
          <div className={`print-root mx-auto ${settings.receiptWidth === "A4" ? "w-full max-w-[186mm]" : "w-fit"}`}>
            <div className="shadow-[0_6px_20px_rgba(10,20,40,0.12)]">
              <ReceiptSheet data={data} org={org} branch={branch} settings={settings} design={design} stamp={stamp} />
              <div className="receipt-paper-edge" aria-hidden />
            </div>
          </div>
        </div>

        {/* ── WhatsApp: for when the printer is out of paper, or the customer prefers it. */}
        {waOpen ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendWhatsApp();
            }}
            className="border-t border-hairline px-4 pt-4"
          >
            <label htmlFor="wa-phone" className="text-xs font-bold uppercase tracking-wide text-ink-500">
              Customer&apos;s WhatsApp number
            </label>
            <div className="mt-1.5 flex gap-2">
              <input
                id="wa-phone"
                ref={waRef}
                type="tel"
                inputMode="tel"
                autoComplete="off"
                placeholder="0803 123 4567"
                value={waPhone}
                onChange={(e) => {
                  setWaPhone(e.target.value);
                  setWaError(null);
                }}
                className="input flex-1"
              />
              <button type="submit" className="btn btn-navy">
                <Send className="h-4 w-4" aria-hidden />
                Send
              </button>
            </div>
            <p className={`mt-1 text-xs ${waError ? "text-sell-700" : "text-ink-500"}`}>
              {waError ?? "Opens WhatsApp with the receipt typed out. Press send there."}
            </p>
          </form>
        ) : null}

        {/* ── Actions ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-2 border-t border-hairline p-4">
          <button type="button" onClick={() => void printReceipt(sheetEl())} className="btn btn-dark">
            <Printer className="h-4 w-4" aria-hidden />
            Print
          </button>
          <button
            type="button"
            onClick={() => (waOpen ? setWaOpen(false) : openWhatsApp())}
            aria-expanded={waOpen}
            className="btn btn-outline"
          >
            <MessageCircle className="h-4 w-4" aria-hidden />
            WhatsApp
          </button>
          <button type="button" onClick={onClose} className="btn btn-primary">
            <Plus className="h-4 w-4" aria-hidden />
            New sale
          </button>
        </div>
        <p className="-mt-2 hidden pb-3 text-center text-xs text-ink-400 sm:block">
          Enter for the next customer · P to print · W for WhatsApp
        </p>
      </div>
    </div>
  );
}

/** 0803..., 803..., +234 803... to 234803...; other international numbers pass through. */
function toWhatsAppNumber(input: string): string | null {
  const d = input.replace(/\D/g, "");
  if (d.startsWith("234")) return d.length === 13 ? d : null;
  if (d.startsWith("0")) return d.length === 11 ? `234${d.slice(1)}` : null;
  if (d.length === 10) return `234${d}`;
  return d.length >= 11 && d.length <= 15 ? d : null;
}

/** The receipt as a plain WhatsApp message. *Stars* make bold in WhatsApp. */
function receiptText(
  data: ReceiptData,
  org: { name: string; phone: string | null; address?: string | null },
  branch: { name: string },
  settings: { receiptHeader: string | null; receiptFooter: string; receiptShowCashier: boolean },
  design: ReceiptDesign,
  stamp: string,
): string {
  const lines: string[] = [`*${org.name}*`];
  if (settings.receiptHeader) lines.push(settings.receiptHeader);
  if (design.showBranch) lines.push(branch.name);
  lines.push("");
  lines.push(`Receipt ${data.receiptNo ?? "(saved offline)"}`);
  lines.push(stamp);
  if (settings.receiptShowCashier) lines.push(`Served by ${data.cashierName}`);
  lines.push("");
  for (const it of data.items) {
    lines.push(`${it.quantity} x ${it.name}`);
    lines.push(`    ${formatNaira(it.lineTotalKobo)}`);
  }
  lines.push("");
  if (data.discountKobo > 0) {
    lines.push(`Subtotal: ${formatNaira(data.subtotalKobo)}`);
    lines.push(`Discount: -${formatNaira(data.discountKobo)}`);
  }
  if (data.taxKobo > 0) lines.push(`VAT: ${formatNaira(data.taxKobo)}`);
  lines.push(`*Total: ${formatNaira(data.totalKobo)}*`);
  lines.push(`Paid (${PAYMENT_METHOD_LABELS[data.paymentMethod] ?? data.paymentMethod}): ${formatNaira(data.paidKobo)}`);
  if (data.changeKobo > 0) lines.push(`Change: ${formatNaira(data.changeKobo)}`);
  if (data.balanceKobo > 0) lines.push(`*Balance owed: ${formatNaira(data.balanceKobo)}*`);
  if (design.showSavings && data.discountKobo > 0) lines.push(`You saved ${formatNaira(data.discountKobo)} today`);
  lines.push("");
  if (settings.receiptFooter) lines.push(settings.receiptFooter);
  const phones = receiptPhones(design, org.phone);
  if (phones.length) lines.push(`Call us: ${phones.join(", ")}`);
  if (design.extraLine) lines.push(design.extraLine);
  return lines.join("\n");
}
