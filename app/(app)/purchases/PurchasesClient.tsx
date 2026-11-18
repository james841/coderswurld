"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Search, ChevronRight } from "lucide-react";

import { formatNaira } from "@/lib/money";

export interface PurchaseListRow {
  id: string;
  reference: string;
  invoiceNo: string | null;
  purchaseDate: string; // ISO
  totalKobo: number;
  amountPaidKobo: number;
  balanceKobo: number;
  paymentStatus: string;
  status: string;
  supplierId: string;
  supplierName: string;
  branchName: string;
  branchCode: string;
  itemCount: number;
}

type StatusFilter = "all" | "owing" | "paid";

export function PurchasesClient({
  initial,
  canManage,
  timezone,
  multiBranch,
}: {
  initial: PurchaseListRow[];
  canManage: boolean;
  timezone: string;
  multiBranch: boolean;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");

  const fmtDate = useMemo(
    () => new Intl.DateTimeFormat("en-NG", { timeZone: timezone, dateStyle: "medium" }),
    [timezone],
  );

  const counts = useMemo(
    () => ({
      all: initial.length,
      owing: initial.filter((p) => p.balanceKobo > 0).length,
      paid: initial.filter((p) => p.balanceKobo <= 0).length,
    }),
    [initial],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return initial.filter((p) => {
      if (status === "owing" && p.balanceKobo <= 0) return false;
      if (status === "paid" && p.balanceKobo > 0) return false;
      if (!q) return true;
      return (
        p.reference.toLowerCase().includes(q) ||
        p.supplierName.toLowerCase().includes(q) ||
        (p.invoiceNo?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [initial, search, status]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search PO number, supplier or invoice"
            className="input h-10 w-full pl-9"
            aria-label="Search purchases"
          />
        </div>

        {canManage && (
          <Link href="/purchases/new" className="btn btn-primary">
            <Plus className="size-4" />
            Record goods received
          </Link>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <FilterChip label="All" count={counts.all} active={status === "all"} onClick={() => setStatus("all")} />
        <FilterChip label="Owing" count={counts.owing} active={status === "owing"} onClick={() => setStatus("owing")} />
        <FilterChip label="Paid" count={counts.paid} active={status === "paid"} onClick={() => setStatus("paid")} />
      </div>

      {filtered.length === 0 ? (
        <p className="card card-pad text-center text-sm text-ink-500">
          {search || status !== "all"
            ? "No purchase matches that."
            : "No deliveries recorded yet."}
        </p>
      ) : (
        <div className="card overflow-hidden">
          {/* Desktop: a ledger table. Mobile: the same rows, stacked. */}
          <div className="hidden sm:block">
            <table className="data-table">
              <thead>
                <tr>
                  <th>PO / supplier</th>
                  {multiBranch && <th>Branch</th>}
                  <th>Date</th>
                  <th data-numeric>Items</th>
                  <th data-numeric>Total</th>
                  <th>Payment</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id} className="cursor-pointer">
                    <td>
                      <Link href={`/purchases/${p.id}`} className="block">
                        <span className="font-semibold text-ink-950">{p.reference}</span>
                        <span className="block truncate text-xs text-ink-500">{p.supplierName}</span>
                      </Link>
                    </td>
                    {multiBranch && <td className="text-ink-600">{p.branchCode}</td>}
                    <td className="whitespace-nowrap text-ink-600">{fmtDate.format(new Date(p.purchaseDate))}</td>
                    <td data-numeric className="text-ink-600">{p.itemCount}</td>
                    <td data-numeric className="font-semibold text-ink-900">{formatNaira(p.totalKobo)}</td>
                    <td><PaymentBadge status={p.paymentStatus} balanceKobo={p.balanceKobo} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="divide-y divide-hairline sm:hidden">
            {filtered.map((p) => (
              <li key={p.id}>
                <Link href={`/purchases/${p.id}`} className="flex items-center gap-3 p-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-ink-950">{p.reference}</span>
                      <PaymentBadge status={p.paymentStatus} balanceKobo={p.balanceKobo} />
                    </div>
                    <span className="block truncate text-sm text-ink-600">{p.supplierName}</span>
                    <span className="block text-xs text-ink-400">
                      {fmtDate.format(new Date(p.purchaseDate))} · {p.itemCount} item{p.itemCount === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="tabular block font-semibold text-ink-900">{formatNaira(p.totalKobo)}</span>
                    <ChevronRight className="ml-auto mt-1 size-4 text-ink-300" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
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

export function PaymentBadge({ status, balanceKobo }: { status: string; balanceKobo: number }) {
  if (status === "PAID" || balanceKobo <= 0) {
    return <span className="badge badge-good">Paid</span>;
  }
  if (status === "PARTIAL") {
    return (
      <span className="badge badge-warn">Owing {formatNaira(balanceKobo)}</span>
    );
  }
  return <span className="badge badge-bad">Unpaid</span>;
}
