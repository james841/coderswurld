"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Banknote, ArrowLeftRight, CreditCard, Clock3, X } from "lucide-react";

import { settle, type SalePaymentSubmit } from "@/lib/pos";
import { formatNaira, suggestTenderAmounts, toKobo } from "@/lib/money";
import type { PaymentMethod } from "@/lib/constants";

/** What the till needs back to post the sale and print the receipt. */
export interface PayPayload {
  payments: SalePaymentSubmit[];
  tenderedKobo: number;
  customerId: string | null;
  method: PaymentMethod;
  paidKobo: number;
  balanceKobo: number;
  changeKobo: number;
}

type Tab = "CASH" | "TRANSFER" | "POS" | "CREDIT";

const TABS: { id: Tab; label: string; icon: typeof Banknote }[] = [
  { id: "CASH", label: "Cash", icon: Banknote },
  { id: "TRANSFER", label: "Transfer", icon: ArrowLeftRight },
  { id: "POS", label: "Card", icon: CreditCard },
  { id: "CREDIT", label: "Credit", icon: Clock3 },
];

export default function PayDialog({
  totalKobo,
  canCredit,
  requireCustomerForCredit,
  submitting,
  error,
  onCancel,
  onComplete,
}: {
  totalKobo: number;
  canCredit: boolean;
  requireCustomerForCredit: boolean;
  submitting: boolean;
  error: string | null;
  onCancel: () => void;
  onComplete: (pay: PayPayload) => void;
}) {
  const [tab, setTab] = useState<Tab>("CASH");
  const [cashInput, setCashInput] = useState("");
  const [depositInput, setDepositInput] = useState("");
  const cashRef = useRef<HTMLInputElement>(null);

  const tabs = TABS.filter((t) => t.id !== "CREDIT" || canCredit);

  useEffect(() => {
    if (tab === "CASH") requestAnimationFrame(() => cashRef.current?.focus());
  }, [tab]);

  // Everything flows from `settle` so the receipt and the server agree exactly.
  const { payload, blockReason, change, balance } = useMemo(() => {
    let payments: SalePaymentSubmit[] = [];
    let tenderedKobo = 0;

    if (tab === "CASH") {
      tenderedKobo = toKobo(cashInput);
      const applied = Math.min(tenderedKobo, totalKobo);
      payments = applied > 0 ? [{ method: "CASH", amountKobo: applied }] : [];
    } else if (tab === "TRANSFER") {
      payments = [{ method: "TRANSFER", amountKobo: totalKobo }];
    } else if (tab === "POS") {
      payments = [{ method: "POS", amountKobo: totalKobo }];
    } else {
      // CREDIT, with an optional cash deposit now.
      const deposit = Math.min(toKobo(depositInput), totalKobo);
      tenderedKobo = deposit;
      payments = deposit > 0 ? [{ method: "CASH", amountKobo: deposit }] : [];
    }

    const s = settle({ totalKobo, payments, tenderedKobo });
    const pay: PayPayload = {
      payments,
      tenderedKobo,
      customerId: null,
      method: s.method,
      paidKobo: s.paidKobo,
      balanceKobo: s.balanceKobo,
      changeKobo: s.changeKobo,
    };

    // Can this sale actually be completed as entered?
    let reason: string | null = null;
    if (totalKobo <= 0) {
      reason = "Nothing to charge.";
    } else if (s.balanceKobo > 0) {
      // A shortfall means the rest is owed — that's a credit sale.
      if (!canCredit) {
        reason =
          tab === "CASH"
            ? "That's less than the total. Enter the full amount, or ask a manager to sell on credit."
            : "You don't have permission to sell on credit.";
      } else if (requireCustomerForCredit) {
        reason = "Credit sales need a customer on file. Add the customer in the back office first.";
      }
    }

    return { payload: pay, blockReason: reason, change: s.changeKobo, balance: s.balanceKobo };
  }, [tab, cashInput, depositInput, totalKobo, canCredit, requireCustomerForCredit]);

  const quickTenders = useMemo(() => suggestTenderAmounts(totalKobo), [totalKobo]);

  const canComplete = !submitting && blockReason === null;

  const complete = () => {
    if (!canComplete) return;
    onComplete(payload);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/50 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !submitting) onCancel();
      }}
    >
      <div className="animate-slide-up w-full max-w-md rounded-t-2xl bg-surface shadow-xl sm:rounded-2xl">
        {/* Header: the number that matters, big */}
        <div className="flex items-start justify-between border-b border-hairline p-5">
          <div>
            <p className="text-sm text-ink-500">Amount due</p>
            <p className="text-3xl font-bold tabular-nums tracking-tight text-ink-900">
              {formatNaira(totalKobo, { alwaysShowKobo: true })}
            </p>
          </div>
          <button
            type="button"
            onClick={() => !submitting && onCancel()}
            className="rounded-lg p-1.5 text-ink-500 transition hover:bg-canvas"
            aria-label="Cancel payment"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="p-5">
          {/* Method tabs */}
          <div
            className="grid gap-1.5"
            style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
          >
            {tabs.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  aria-pressed={active}
                  className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-3 text-xs font-medium transition ${
                    active
                      ? "border-brand-700 bg-brand-50 text-brand-700"
                      : "border-hairline bg-surface text-ink-600 hover:border-ink-300"
                  }`}
                >
                  <Icon className="h-5 w-5" aria-hidden />
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* Per-method body */}
          <div className="mt-5">
            {tab === "CASH" && (
              <div className="space-y-3">
                <label className="block">
                  <span className="mb-1 block text-sm text-ink-500">Cash received</span>
                  <input
                    ref={cashRef}
                    inputMode="decimal"
                    value={cashInput}
                    onChange={(e) => setCashInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") complete();
                    }}
                    placeholder="0"
                    className="h-14 w-full rounded-xl border border-hairline bg-canvas px-4 text-right text-2xl font-bold tabular-nums outline-none focus:border-brand-700 focus:bg-surface"
                  />
                </label>

                <div className="flex flex-wrap gap-1.5">
                  {quickTenders.map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setCashInput(String(amt / 100))}
                      className="rounded-lg border border-hairline bg-surface px-3 py-1.5 text-sm font-medium text-ink-700 transition hover:border-brand-700 hover:text-brand-700"
                    >
                      {amt === totalKobo ? "Exact" : formatNaira(amt)}
                    </button>
                  ))}
                </div>

                {change > 0 && (
                  <div className="flex items-end justify-between rounded-xl bg-good-50 px-4 py-3">
                    <span className="text-sm font-medium text-good-700">Change</span>
                    <span className="text-2xl font-bold tabular-nums text-good-700">
                      {formatNaira(change, { alwaysShowKobo: true })}
                    </span>
                  </div>
                )}
                {balance > 0 && (
                  <div className="flex items-end justify-between rounded-xl bg-warn-50 px-4 py-3">
                    <span className="text-sm font-medium text-warn-700">Balance owed</span>
                    <span className="text-xl font-bold tabular-nums text-warn-700">
                      {formatNaira(balance, { alwaysShowKobo: true })}
                    </span>
                  </div>
                )}
              </div>
            )}

            {(tab === "TRANSFER" || tab === "POS") && (
              <div className="rounded-xl bg-canvas px-4 py-5 text-center">
                <p className="text-sm text-ink-500">
                  Mark as paid in full by {tab === "TRANSFER" ? "bank transfer" : "card / POS"}.
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-ink-900">
                  {formatNaira(totalKobo)}
                </p>
              </div>
            )}

            {tab === "CREDIT" && (
              <div className="space-y-3">
                <label className="block">
                  <span className="mb-1 block text-sm text-ink-500">Deposit now (optional)</span>
                  <input
                    inputMode="decimal"
                    value={depositInput}
                    onChange={(e) => setDepositInput(e.target.value)}
                    placeholder="0"
                    className="h-12 w-full rounded-xl border border-hairline bg-canvas px-4 text-right text-xl font-bold tabular-nums outline-none focus:border-brand-700 focus:bg-surface"
                  />
                </label>
                <div className="flex items-end justify-between rounded-xl bg-warn-50 px-4 py-3">
                  <span className="text-sm font-medium text-warn-700">Will be owed</span>
                  <span className="text-xl font-bold tabular-nums text-warn-700">
                    {formatNaira(balance, { alwaysShowKobo: true })}
                  </span>
                </div>
              </div>
            )}
          </div>

          {(blockReason || error) && (
            <p className="mt-4 rounded-lg bg-bad-50 px-3 py-2 text-sm text-bad-700">
              {error ?? blockReason}
            </p>
          )}

          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={() => !submitting && onCancel()}
              className="btn btn-outline flex-1"
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={complete}
              disabled={!canComplete}
              className="btn btn-primary btn-lg flex-[2] disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Complete sale"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
