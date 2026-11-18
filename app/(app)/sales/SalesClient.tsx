"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  Search,
  ScanLine,
  Banknote,
  ReceiptText,
  Clock,
} from "lucide-react";

import { formatNaira } from "@/lib/money";
import {
  PAYMENT_METHOD_LABELS,
  SALE_STATUS_LABELS,
  type PaymentMethod,
  type SaleStatus,
} from "@/lib/constants";

import { StatTile } from "@/components/ui/StatTile";

export interface SaleListRow {
  id: string;
  receiptNo: string;
  soldAt: string; // ISO
  totalKobo: number;
  paidKobo: number;
  balanceKobo: number;
  changeKobo: number;
  paymentMethod: string;
  priceMode: string;
  status: string;
  cashierId: string;
  cashierName: string;
  customerName: string | null;
  itemCount: number;
}

/** The order methods appear in the chip row — the counter's own frequency order. */
const METHOD_ORDER = ["CASH", "TRANSFER", "POS", "CREDIT", "SPLIT"];

const methodLabel = (m: string) => PAYMENT_METHOD_LABELS[m as PaymentMethod] ?? m;
const statusLabel = (s: string) => SALE_STATUS_LABELS[s as SaleStatus] ?? s;

export function SalesClient({
  initial,
  canViewAll,
  canSell,
  timezone,
  dateLabel,
  prevDate,
  nextDate,
  isToday,
  truncated,
  totalCount,
}: {
  initial: SaleListRow[];
  canViewAll: boolean;
  canSell: boolean;
  timezone: string;
  dateLabel: string;
  prevDate: string;
  nextDate: string | null;
  isToday: boolean;
  truncated: boolean;
  totalCount: number;
}) {
  const [search, setSearch] = useState("");
  const [method, setMethod] = useState<"all" | string>("all");
  const [cashier, setCashier] = useState<"all" | string>("all");
  const [hideVoided, setHideVoided] = useState(false);

  const fmtTime = useMemo(
    () =>
      new Intl.DateTimeFormat("en-NG", {
        timeZone: timezone,
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }),
    [timezone],
  );

  // The day's figures are the day's figures — takings don't move when you filter
  // the view below. So the three tiles are read straight off the completed sales,
  // never off `filtered`.
  const totals = useMemo(() => {
    let takingsKobo = 0;
    let creditKobo = 0;
    let grossKobo = 0;
    let salesCount = 0;
    for (const s of initial) {
      if (s.status !== "COMPLETED") continue;
      takingsKobo += s.paidKobo;
      creditKobo += s.balanceKobo;
      grossKobo += s.totalKobo;
      salesCount += 1;
    }
    const avgKobo = salesCount > 0 ? Math.round(grossKobo / salesCount) : 0;
    return { takingsKobo, creditKobo, salesCount, avgKobo };
  }, [initial]);

  const voidedCount = useMemo(
    () => initial.reduce((n, s) => (s.status === "COMPLETED" ? n : n + 1), 0),
    [initial],
  );

  // Everything downstream — chips, cashier list, the table — reads from `base`,
  // which is `initial` minus the reversed sales when they're being hidden.
  const base = useMemo(
    () => (hideVoided ? initial.filter((s) => s.status === "COMPLETED") : initial),
    [initial, hideVoided],
  );

  const byMethod = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of base) map.set(s.paymentMethod, (map.get(s.paymentMethod) ?? 0) + 1);
    return map;
  }, [base]);

  const methodChips = useMemo(
    () =>
      METHOD_ORDER.filter((m) => byMethod.has(m)).map((m) => ({
        key: m,
        label: methodLabel(m),
        count: byMethod.get(m) ?? 0,
      })),
    [byMethod],
  );

  // Only meaningful when the manager can see the whole floor; derived from every
  // row so a cashier with no sales left after filtering still stays selectable.
  const cashiers = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of initial) if (!map.has(s.cashierId)) map.set(s.cashierId, s.cashierName);
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [initial]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return base.filter((s) => {
      if (method !== "all" && s.paymentMethod !== method) return false;
      if (cashier !== "all" && s.cashierId !== cashier) return false;
      if (!q) return true;
      return (
        s.receiptNo.toLowerCase().includes(q) ||
        (s.customerName?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [base, method, cashier, search]);

  const hasAny = initial.length > 0;
  const showCashierCol = canViewAll;

  return (
    <div className="space-y-4">
      {/* Which day, and the one bold action */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex items-center gap-1 rounded-lg border border-ink-200 bg-surface p-1">
          <Link
            href={`/sales?date=${prevDate}`}
            className="btn btn-icon btn-sm text-ink-600 hover:bg-ink-50"
            aria-label="Previous day"
          >
            <ChevronLeft className="size-4" />
          </Link>
          <span className="min-w-[7.5rem] text-center text-sm font-semibold text-ink-900">
            {dateLabel}
          </span>
          {nextDate ? (
            <Link
              href={`/sales?date=${nextDate}`}
              className="btn btn-icon btn-sm text-ink-600 hover:bg-ink-50"
              aria-label="Next day"
            >
              <ChevronRight className="size-4" />
            </Link>
          ) : (
            <span aria-hidden className="btn btn-icon btn-sm cursor-not-allowed text-ink-300">
              <ChevronRight className="size-4" />
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {!isToday && (
            <Link href="/sales" className="btn btn-outline btn-sm">
              Today
            </Link>
          )}
          {canSell && (
            <Link href="/pos" className="btn btn-primary">
              <ScanLine className="size-4" />
              Sell at till
            </Link>
          )}
        </div>
      </div>

      {/* How the day went */}
      {hasAny && (
        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile
            icon={Banknote}
            label="Takings"
            value={formatNaira(totals.takingsKobo)}
            note={`${totals.salesCount} ${totals.salesCount === 1 ? "sale" : "sales"}`}
            accent
          />
          <StatTile
            icon={ReceiptText}
            label="Sales"
            value={String(totals.salesCount)}
            note={totals.salesCount > 0 ? `${formatNaira(totals.avgKobo)} average` : "all voided"}
          />
          <StatTile
            icon={Clock}
            label="On credit"
            value={formatNaira(totals.creditKobo)}
            note={totals.creditKobo > 0 ? "owed to you" : "all settled"}
            tone={totals.creditKobo > 0 ? "warn" : "plain"}
          />
        </div>
      )}

      {hasAny && (
        <>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by receipt or customer"
                className="input h-10 w-full pl-9"
                aria-label="Search sales"
              />
            </div>
            {canViewAll && cashiers.length > 1 && (
              <select
                value={cashier}
                onChange={(e) => setCashier(e.target.value)}
                className="select h-10 sm:w-52"
                aria-label="Filter by cashier"
              >
                <option value="all">All cashiers</option>
                {cashiers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <FilterChip
              label="All"
              count={base.length}
              active={method === "all"}
              onClick={() => setMethod("all")}
            />
            {methodChips.map((c) => (
              <FilterChip
                key={c.key}
                label={c.label}
                count={c.count}
                active={method === c.key}
                onClick={() => setMethod(c.key)}
              />
            ))}
            {voidedCount > 0 && (
              <button
                type="button"
                onClick={() => setHideVoided((v) => !v)}
                className="btn btn-ghost btn-sm ml-auto text-ink-500 hover:text-ink-900"
              >
                {hideVoided ? `Show voided (${voidedCount})` : `Hide voided (${voidedCount})`}
              </button>
            )}
          </div>
        </>
      )}

      {/* The receipts */}
      {!hasAny ? (
        isToday && canSell ? (
          <EmptySales />
        ) : (
          <p className="card card-pad text-center text-sm text-ink-500">
            No sales on {dateLabel}.
          </p>
        )
      ) : filtered.length === 0 ? (
        <p className="card card-pad text-center text-sm text-ink-500">
          No sale matches your search.
        </p>
      ) : (
        <div className="card overflow-hidden">
          {/* Desktop: a day's ledger. Mobile: the same receipts, stacked. */}
          <div className="hidden sm:block">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Receipt</th>
                  <th>Time</th>
                  {showCashierCol && <th>Cashier</th>}
                  <th data-numeric>Items</th>
                  <th data-numeric>Total</th>
                  <th>Payment</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => {
                  const voided = s.status !== "COMPLETED";
                  return (
                    <tr key={s.id}>
                      <td>
                        <Link
                          href={`/sales/${s.id}`}
                          className={`font-semibold ${
                            voided
                              ? "text-ink-400 hover:text-ink-600"
                              : "text-ink-900 hover:text-brand-700"
                          }`}
                        >
                          {s.receiptNo}
                        </Link>
                        {voided && (
                          <span className="badge badge-bad ml-2 align-middle">
                            {statusLabel(s.status)}
                          </span>
                        )}
                        {s.customerName && (
                          <span className="block max-w-[16rem] truncate text-xs text-ink-400">
                            {s.customerName}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap text-ink-600">
                        {fmtTime.format(new Date(s.soldAt))}
                      </td>
                      {showCashierCol && (
                        <td className="max-w-[12rem] truncate text-ink-600">{s.cashierName}</td>
                      )}
                      <td data-numeric className="tabular text-ink-600">
                        {s.itemCount}
                      </td>
                      <td
                        data-numeric
                        className={`tabular font-semibold ${
                          voided ? "text-ink-400 line-through" : "text-ink-900"
                        }`}
                      >
                        {formatNaira(s.totalKobo)}
                      </td>
                      <td>
                        <div className="flex flex-col items-start gap-1">
                          <span className="badge badge-neutral">{methodLabel(s.paymentMethod)}</span>
                          {!voided && s.balanceKobo > 0 && (
                            <span className="badge badge-warn">
                              {formatNaira(s.balanceKobo)} owing
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <ul className="divide-y divide-hairline sm:hidden">
            {filtered.map((s) => {
              const voided = s.status !== "COMPLETED";
              return (
                <li key={s.id}>
                  <Link href={`/sales/${s.id}`} className="flex items-center gap-3 p-3.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`truncate font-semibold ${
                            voided ? "text-ink-400" : "text-ink-900"
                          }`}
                        >
                          {s.receiptNo}
                        </span>
                        {voided && (
                          <span className="badge badge-bad shrink-0">{statusLabel(s.status)}</span>
                        )}
                      </div>
                      <span className="mt-0.5 block text-xs text-ink-400">
                        {fmtTime.format(new Date(s.soldAt))}
                      </span>
                      {canViewAll && (
                        <span className="block truncate text-xs text-ink-400">{s.cashierName}</span>
                      )}
                      {s.customerName && (
                        <span className="block truncate text-xs text-ink-400">
                          {s.customerName}
                        </span>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span
                        className={`tabular font-semibold ${
                          voided ? "text-ink-400 line-through" : "text-ink-900"
                        }`}
                      >
                        {formatNaira(s.totalKobo)}
                      </span>
                      <span className="badge badge-neutral">{methodLabel(s.paymentMethod)}</span>
                      {!voided && s.balanceKobo > 0 && (
                        <span className="badge badge-warn">{formatNaira(s.balanceKobo)} owing</span>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {truncated && (
        <p className="text-center text-xs text-ink-400">
          Showing the latest {initial.length.toLocaleString()} of {totalCount.toLocaleString()}.
          Narrow by cashier or search to find an older receipt.
        </p>
      )}
    </div>
  );
}

function EmptySales() {
  return (
    <div className="card card-pad text-center">
      <div className="mx-auto mb-3 grid size-11 place-items-center rounded-full bg-ink-50">
        <ReceiptText className="size-5 text-ink-400" />
      </div>
      <p className="text-sm font-semibold text-ink-900">No sales yet today</p>
      <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-ink-500">
        The moment you ring up a sale at the till, its receipt shows here — with the day&apos;s
        takings totalled above.
      </p>
      <Link href="/pos" className="btn btn-primary mt-4">
        <ScanLine className="size-4" />
        Sell at till
      </Link>
    </div>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className={`chip ${active ? "chip-active-all" : ""}`}>
      {label}
      <span className="chip-count">{count}</span>
    </button>
  );
}
