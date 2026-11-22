"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X, ChevronRight } from "lucide-react";

import { MOVEMENT_LABELS, type MovementType } from "@/lib/constants";

/**
 * Stock levels, client side.
 *
 * The server hands down the whole active catalogue with its on-hand figures in
 * one lean payload, so everything here — search, the low/out triage, the counts
 * on the chips — happens in memory with no second request. That's the point of
 * the screen: a shopkeeper opens it and the shelf is right there, instantly.
 *
 * The one thing that does talk to the server is the adjust sheet: it reads the
 * recent ledger when it opens (so you can see what moved before you touch it) and
 * writes a single recount or adjustment, then the list refreshes.
 */

export interface StockRow {
  productId: string;
  name: string;
  sku: string;
  unit: string;
  quantity: number;
  minStock: number;
  trackExpiry: boolean;
  expiryDate: string | null; // ISO
  lastCountedAt: string | null; // ISO
}

type Filter = "all" | "low" | "out";
type Status = "ok" | "low" | "out";

const fmtQty = new Intl.NumberFormat("en-NG", { maximumFractionDigits: 2 });

function statusOf(r: StockRow): Status {
  if (r.quantity <= 0) return "out";
  if (r.minStock > 0 && r.quantity <= r.minStock) return "low";
  return "ok";
}

function signedQty(n: number): string {
  // Negatives already carry a minus sign; only positives need the plus.
  return n > 0 ? `+${fmtQty.format(n)}` : fmtQty.format(n);
}

export function StockClient({
  rows,
  branches,
  selectedBranchId,
  multiBranch,
  initialFilter,
  canAdjust,
  timezone,
  truncated,
  serverMode,
}: {
  rows: StockRow[];
  branches: { id: string; name: string; code: string }[];
  selectedBranchId: string;
  multiBranch: boolean;
  initialFilter: Filter;
  canAdjust: boolean;
  timezone: string;
  truncated: boolean;
  /**
   * A big shop: rows are already searched and filtered on the server, and the
   * counts come from there too. Typing and the filter chips update the address
   * instead of filtering in the browser.
   */
  serverMode: { counts: { all: number; low: number; out: number }; query: string } | null;
}) {
  const router = useRouter();
  const [search, setSearch] = useState(serverMode?.query ?? "");
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [adjusting, setAdjusting] = useState<StockRow | null>(null);

  const fmtDate = useMemo(
    () => new Intl.DateTimeFormat("en-NG", { timeZone: timezone, dateStyle: "medium" }),
    [timezone],
  );

  // The wall clock can't be read during render (it's impure), so we read it once
  // after mount and feed that single "now" into every expiry comparison. Until it
  // lands a frame later, expiry flags simply stay hidden — they're a soft signal.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const id = requestAnimationFrame(() => setNow(Date.now()));
    return () => cancelAnimationFrame(id);
  }, []);

  // Big shop: send the search to the server a moment after typing stops.
  useEffect(() => {
    if (!serverMode) return;
    if (search.trim() === serverMode.query) return;
    const id = setTimeout(() => {
      const params = new URLSearchParams({ branch: selectedBranchId });
      if (filter !== "all") params.set("filter", filter);
      if (search.trim()) params.set("q", search.trim());
      router.replace(`/stock?${params}`);
    }, 350);
    return () => clearTimeout(id);
  }, [search, serverMode, filter, selectedBranchId, router]);

  function chooseFilter(next: Filter) {
    setFilter(next);
    if (!serverMode) return;
    const params = new URLSearchParams({ branch: selectedBranchId });
    if (next !== "all") params.set("filter", next);
    if (search.trim()) params.set("q", search.trim());
    router.replace(`/stock?${params}`);
  }

  const counts = useMemo(() => {
    if (serverMode) return serverMode.counts;
    let low = 0;
    let out = 0;
    for (const r of rows) {
      const s = statusOf(r);
      if (s === "out") out += 1;
      else if (s === "low") low += 1;
    }
    return { all: rows.length, low, out };
  }, [rows, serverMode]);

  const filtered = useMemo(() => {
    if (serverMode) return rows;
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const s = statusOf(r);
      if (filter === "low" && s !== "low") return false;
      if (filter === "out" && s !== "out") return false;
      if (!q) return true;
      return r.name.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q);
    });
  }, [rows, search, filter, serverMode]);

  function changeBranch(id: string) {
    const query = filter === "all" ? "" : `&filter=${filter}`;
    router.push(`/stock?branch=${encodeURIComponent(id)}${query}`);
  }

  return (
    <div className="space-y-4">
      {/* Toolbar: find a product, and (for multi-branch admins) choose where */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[min(100%,16rem)] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or code"
            className="input h-10 w-full pl-9"
            aria-label="Search products"
          />
        </div>

        {multiBranch && (
          <select
            value={selectedBranchId}
            onChange={(e) => changeBranch(e.target.value)}
            className="select h-10 w-auto"
            aria-label="Branch"
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <FilterChip label="All" count={counts.all} active={filter === "all"} onClick={() => chooseFilter("all")} />
        <FilterChip label="Low" count={counts.low} active={filter === "low"} onClick={() => chooseFilter("low")} />
        <FilterChip label="Out" count={counts.out} active={filter === "out"} onClick={() => chooseFilter("out")} />
      </div>

      {filtered.length === 0 ? (
        <p className="card card-pad text-center text-sm text-ink-500">
          {search
            ? `No product matches “${search}”.`
            : filter === "low"
              ? "Nothing is running low — every tracked item is above its minimum."
              : filter === "out"
                ? "Nothing is out of stock right now."
                : "No products to show."}
        </p>
      ) : (
        <div className="card overflow-hidden">
          {/* Desktop: a count sheet. Mobile: the same rows, stacked and tappable. */}
          <div className="hidden sm:block">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th data-numeric>On hand</th>
                  <th data-numeric>Min</th>
                  <th>Status</th>
                  {canAdjust && <th className="w-0" />}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const expiry = expiryNote(r, now, fmtDate);
                  return (
                    <tr key={r.productId}>
                      <td>
                        <span className="font-semibold text-ink-950">{r.name}</span>
                        <span className="block text-xs text-ink-400">{r.sku}</span>
                        {expiry && (
                          <span className={`block text-xs font-medium ${expiry.tone === "bad" ? "text-bad-700" : "text-warn-700"}`}>
                            {expiry.text}
                          </span>
                        )}
                      </td>
                      <td data-numeric>
                        <span className={`tabular font-semibold ${r.quantity <= 0 ? "text-bad-700" : "text-ink-900"}`}>
                          {fmtQty.format(r.quantity)}
                        </span>
                        <span className="ml-1 text-xs text-ink-400">{r.unit}</span>
                      </td>
                      <td data-numeric className="tabular text-ink-500">
                        {r.minStock > 0 ? fmtQty.format(r.minStock) : "—"}
                      </td>
                      <td>
                        <StatusBadge status={statusOf(r)} />
                      </td>
                      {canAdjust && (
                        <td className="text-right">
                          <button
                            type="button"
                            onClick={() => setAdjusting(r)}
                            className="btn btn-outline btn-sm"
                          >
                            Adjust
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <ul className="divide-y divide-hairline sm:hidden">
            {filtered.map((r) => {
              const expiry = expiryNote(r, now, fmtDate);
              const body = (
                <>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-semibold text-ink-950">{r.name}</span>
                      <StatusBadge status={statusOf(r)} />
                    </div>
                    <span className="block text-xs text-ink-400">{r.sku}</span>
                    {expiry && (
                      <span className={`block text-xs font-medium ${expiry.tone === "bad" ? "text-bad-700" : "text-warn-700"}`}>
                        {expiry.text}
                      </span>
                    )}
                  </div>
                  <div className="text-right">
                    <span className={`tabular block font-semibold ${r.quantity <= 0 ? "text-bad-700" : "text-ink-900"}`}>
                      {fmtQty.format(r.quantity)} <span className="text-xs font-normal text-ink-400">{r.unit}</span>
                    </span>
                    {canAdjust && <ChevronRight className="ml-auto mt-1 size-4 text-ink-300" />}
                  </div>
                </>
              );
              return (
                <li key={r.productId}>
                  {canAdjust ? (
                    <button
                      type="button"
                      onClick={() => setAdjusting(r)}
                      className="flex w-full items-center gap-3 p-3.5 text-left"
                    >
                      {body}
                    </button>
                  ) : (
                    <div className="flex items-center gap-3 p-3.5">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {truncated && (
        <p className="text-center text-xs text-ink-400">
          Showing the first {fmtQty.format(rows.length)}
          {serverMode ? ` of ${fmtQty.format(filter === "all" ? counts.all : filter === "low" ? counts.low : counts.out)}` : ""}{" "}
          products. Use search to find the rest.
        </p>
      )}

      {adjusting && (
        <AdjustSheet
          row={adjusting}
          branchId={selectedBranchId}
          timezone={timezone}
          onClose={() => setAdjusting(null)}
          onSaved={() => {
            setAdjusting(null);
            router.refresh();
          }}
        />
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

function StatusBadge({ status }: { status: Status }) {
  if (status === "out") return <span className="badge badge-bad">Out of stock</span>;
  if (status === "low") return <span className="badge badge-warn">Low</span>;
  return <span className="badge badge-good">In stock</span>;
}

/** A quiet expiry flag, drawn only when it's worth a shopkeeper's attention. */
function expiryNote(
  r: StockRow,
  now: number | null,
  fmtDate: Intl.DateTimeFormat,
): { tone: "bad" | "warn"; text: string } | null {
  if (!r.trackExpiry || !r.expiryDate || now === null) return null;
  const t = new Date(r.expiryDate).getTime();
  if (Number.isNaN(t)) return null;
  const days = Math.ceil((t - now) / 86_400_000);
  if (days < 0) return { tone: "bad", text: `Expired ${fmtDate.format(new Date(r.expiryDate))}` };
  if (days <= 90) return { tone: "warn", text: `Expires ${fmtDate.format(new Date(r.expiryDate))}` };
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Adjust / recount sheet
// ─────────────────────────────────────────────────────────────────────────────

interface Movement {
  id: string;
  type: string;
  quantity: number;
  balanceAfter: number;
  reason: string | null;
  referenceType: string | null;
  referenceId: string | null;
  createdAt: string;
}

type Tab = "count" | "adjust";

/** The adjust-mode reasons. Each sets the ledger type and the sign of the move. */
const ADJUST_REASONS = [
  { key: "found", label: "Found extra stock", type: "ADJUSTMENT", sign: 1 },
  { key: "damage", label: "Damaged / broken", type: "DAMAGE", sign: -1 },
  { key: "expired", label: "Expired / spoiled", type: "EXPIRED", sign: -1 },
  { key: "correction_add", label: "Correction — add", type: "ADJUSTMENT", sign: 1 },
  { key: "correction_remove", label: "Correction — remove", type: "ADJUSTMENT", sign: -1 },
] as const;

function parseQty(s: string): number | null {
  const n = Number(s.replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function AdjustSheet({
  row,
  branchId,
  timezone,
  onClose,
  onSaved,
}: {
  row: StockRow;
  branchId: string;
  timezone: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const current = row.quantity;

  const [tab, setTab] = useState<Tab>("count");

  // Recount
  const [counted, setCounted] = useState(() => fmtQty.format(current));
  // Adjust
  const [reasonKey, setReasonKey] = useState<(typeof ADJUST_REASONS)[number]["key"]>("found");
  const [magnitude, setMagnitude] = useState("");
  // Shared
  const [note, setNote] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const [movements, setMovements] = useState<Movement[] | null>(null);
  const [ledgerFailed, setLedgerFailed] = useState(false);

  const firstFieldRef = useRef<HTMLInputElement>(null);

  const fmtDateTime = useMemo(
    () =>
      new Intl.DateTimeFormat("en-NG", {
        timeZone: timezone,
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [timezone],
  );

  // Focus the first field once the sheet is on screen.
  useEffect(() => {
    const id = requestAnimationFrame(() => firstFieldRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  // Escape closes, unless a save is in flight.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !saving) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [saving, onClose]);

  // Read the recent ledger when the sheet opens — "why is it this number?".
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(
          `/api/stock/movements?productId=${encodeURIComponent(row.productId)}&branchId=${encodeURIComponent(branchId)}`,
        );
        if (!alive) return;
        if (!res.ok) {
          setLedgerFailed(true);
          return;
        }
        const data = (await res.json()) as { movements?: Movement[] };
        if (alive) setMovements(data.movements ?? []);
      } catch {
        if (alive) setLedgerFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [row.productId, branchId]);

  const reason = ADJUST_REASONS.find((r) => r.key === reasonKey)!;

  // What each tab is about to do, as a signed delta and a resulting on-hand.
  const countedValue = parseQty(counted);
  const countDelta = countedValue === null ? null : countedValue - current;

  const magValue = parseQty(magnitude);
  const adjustDelta = magValue && magValue > 0 ? reason.sign * magValue : null;
  const adjustResult = adjustDelta === null ? null : current + adjustDelta;

  const canSubmit =
    tab === "count"
      ? countedValue !== null && countedValue >= 0 && countDelta !== 0
      : adjustDelta !== null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving || !canSubmit) return;
    setSaving(true);
    setError(null);
    setFieldError(null);

    const body =
      tab === "count"
        ? {
            mode: "recount" as const,
            productId: row.productId,
            branchId,
            countedQuantity: countedValue,
            reason: note.trim() || undefined,
          }
        : {
            mode: "adjust" as const,
            productId: row.productId,
            branchId,
            quantity: adjustDelta,
            type: reason.type,
            reason: note.trim() || undefined,
          };

    try {
      const res = await fetch("/api/stock/adjust", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        onSaved();
        return;
      }
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        fields?: Record<string, string>;
      };
      setError(data.error ?? "Couldn't save that change. Please try again.");
      // The server keys quantity problems by field; surface the first one on the input.
      if (data.fields) {
        setFieldError(
          data.fields.countedQuantity ?? data.fields.quantity ?? data.fields.branch ?? null,
        );
      }
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/50 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <form
        onSubmit={submit}
        className="animate-slide-up flex max-h-[94vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-surface shadow-xl sm:rounded-2xl"
      >
        <div className="flex items-start justify-between border-b border-hairline p-4">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-ink-950">Adjust stock</h2>
            <p className="truncate text-sm text-ink-500">{row.name}</p>
          </div>
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
          <div className="flex items-center justify-between rounded-lg bg-ink-50 px-3 py-2.5">
            <span className="text-sm text-ink-500">On hand now</span>
            <span className="tabular text-sm font-bold text-ink-950">
              {fmtQty.format(current)} <span className="font-normal text-ink-400">{row.unit}</span>
            </span>
          </div>

          {/* Two ways to say the same thing — count the shelf, or log a known change */}
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-ink-100 p-1">
            <SegButton active={tab === "count"} onClick={() => setTab("count")}>
              Set count
            </SegButton>
            <SegButton active={tab === "adjust"} onClick={() => setTab("adjust")}>
              Add / remove
            </SegButton>
          </div>

          {tab === "count" ? (
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-ink-800">
                  Counted quantity
                </span>
                <input
                  ref={firstFieldRef}
                  value={counted}
                  onChange={(e) => setCounted(e.target.value)}
                  className="input"
                  inputMode="decimal"
                  placeholder="0"
                  aria-label="Counted quantity"
                />
                {fieldError && (
                  <span className="mt-1 block text-xs font-medium text-bad-700">{fieldError}</span>
                )}
              </label>

              <DeltaLine>
                {countedValue === null ? (
                  <span className="text-ink-400">Enter what you counted on the shelf.</span>
                ) : countDelta === 0 ? (
                  <span className="text-ink-500">Matches the system — nothing to record.</span>
                ) : (
                  <span className={countDelta! > 0 ? "text-good-700" : "text-bad-700"}>
                    {countDelta! > 0 ? "Up" : "Down"} {fmtQty.format(Math.abs(countDelta!))} {row.unit} — records a{" "}
                    {countDelta! > 0 ? "gain" : "loss"} and sets on hand to {fmtQty.format(countedValue)}.
                  </span>
                )}
              </DeltaLine>
            </div>
          ) : (
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-ink-800">Reason</span>
                <select
                  value={reasonKey}
                  onChange={(e) => setReasonKey(e.target.value as typeof reasonKey)}
                  className="select"
                >
                  {ADJUST_REASONS.map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-ink-800">
                  Quantity to {reason.sign > 0 ? "add" : "remove"}
                </span>
                <input
                  ref={firstFieldRef}
                  value={magnitude}
                  onChange={(e) => setMagnitude(e.target.value)}
                  className="input"
                  inputMode="decimal"
                  placeholder="0"
                  aria-label={`Quantity to ${reason.sign > 0 ? "add" : "remove"}`}
                />
                {fieldError && (
                  <span className="mt-1 block text-xs font-medium text-bad-700">{fieldError}</span>
                )}
              </label>

              <DeltaLine>
                {adjustDelta === null ? (
                  <span className="text-ink-400">Enter how many to {reason.sign > 0 ? "add" : "remove"}.</span>
                ) : adjustResult! < 0 ? (
                  <span className="text-bad-700">
                    You only have {fmtQty.format(current)} {row.unit} on hand — you can&rsquo;t remove{" "}
                    {fmtQty.format(magValue!)}.
                  </span>
                ) : (
                  <span className={reason.sign > 0 ? "text-good-700" : "text-ink-700"}>
                    {reason.sign > 0 ? "Adds" : "Removes"} {fmtQty.format(magValue!)} {row.unit} — new on hand{" "}
                    {fmtQty.format(adjustResult!)}.
                  </span>
                )}
              </DeltaLine>
            </div>
          )}

          <label className="block">
            <span className="mb-1 flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold text-ink-800">Note</span>
              <span className="text-xs text-ink-400">Optional</span>
            </span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="input"
              placeholder={tab === "count" ? "e.g. month-end count" : "e.g. carton crushed in storeroom"}
              maxLength={300}
            />
          </label>

          {error && (
            <p className="rounded-lg bg-bad-50 px-3 py-2 text-sm text-bad-700">{error}</p>
          )}

          {/* The ledger: a short tail of what actually moved, newest first */}
          <div className="border-t border-hairline pt-3">
            <p className="section-title mb-2">Recent movements</p>
            {movements === null && !ledgerFailed ? (
              <p className="text-sm text-ink-400">Loading…</p>
            ) : ledgerFailed ? (
              <p className="text-sm text-ink-400">Couldn&rsquo;t load the history.</p>
            ) : movements && movements.length === 0 ? (
              <p className="text-sm text-ink-400">No movements recorded yet.</p>
            ) : (
              <ul className="space-y-2">
                {movements!.map((m) => (
                  <li key={m.id} className="flex items-baseline justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <span className="text-ink-800">
                        {MOVEMENT_LABELS[m.type as MovementType] ?? m.type}
                      </span>
                      <span className="block truncate text-xs text-ink-400">
                        {fmtDateTime.format(new Date(m.createdAt))}
                        {m.referenceId ? ` · ${m.referenceId}` : ""}
                        {m.reason ? ` · ${m.reason}` : ""}
                      </span>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className={`tabular font-semibold ${m.quantity > 0 ? "text-good-700" : "text-bad-700"}`}>
                        {signedQty(m.quantity)}
                      </span>
                      <span className="tabular block text-xs text-ink-400">→ {fmtQty.format(m.balanceAfter)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
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
          <button type="submit" className="btn btn-primary flex-[2]" disabled={saving || !canSubmit}>
            {saving ? "Saving…" : tab === "count" ? "Save count" : "Apply change"}
          </button>
        </div>
      </form>
    </div>
  );
}

function SegButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-3 py-2 text-sm font-semibold transition ${
        active ? "bg-surface text-ink-950 shadow-sm" : "text-ink-500 hover:text-ink-800"
      }`}
    >
      {children}
    </button>
  );
}

function DeltaLine({ children }: { children: React.ReactNode }) {
  return <p className="px-0.5 text-sm font-medium">{children}</p>;
}
