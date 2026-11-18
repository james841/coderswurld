"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Plus,
  Search,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Trash2,
  X,
  Receipt,
} from "lucide-react";

import { formatNaira, parseMoneyInput } from "@/lib/money";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  type ExpenseCategory,
} from "@/lib/constants";

export interface ExpenseRow {
  id: string;
  category: string;
  amountKobo: number;
  description: string | null;
  vendor: string | null;
  paymentMethod: string;
  expenseDate: string; // ISO
  branchId: string | null;
  userName: string | null;
}

type Branch = { id: string; name: string; code: string };

const METHOD_LABELS: Record<string, string> = {
  CASH: "Cash",
  TRANSFER: "Transfer",
  POS: "Card / POS",
  CHEQUE: "Cheque",
};

const categoryLabel = (c: string) =>
  EXPENSE_CATEGORY_LABELS[c as ExpenseCategory] ?? c;

export function ExpensesClient({
  initial,
  branches,
  defaultBranchId,
  multiBranch,
  canManage,
  totalKobo,
  monthLabel,
  prevMonth,
  nextMonth,
  timezone,
}: {
  initial: ExpenseRow[];
  branches: Branch[];
  defaultBranchId: string;
  multiBranch: boolean;
  canManage: boolean;
  totalKobo: number;
  monthLabel: string;
  prevMonth: string;
  nextMonth: string | null;
  timezone: string;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<"all" | string>("all");
  const [editing, setEditing] = useState<ExpenseRow | "new" | null>(null);

  const fmtDate = useMemo(
    () => new Intl.DateTimeFormat("en-NG", { timeZone: timezone, dateStyle: "medium" }),
    [timezone],
  );

  const branchName = useMemo(() => {
    const map = new Map(branches.map((b) => [b.id, b.name]));
    return (id: string | null) => (id ? map.get(id) ?? null : null);
  }, [branches]);

  // Category tallies for the chip row, biggest spend first — the row doubles as
  // an at-a-glance "where did it go this month".
  const byCategory = useMemo(() => {
    const map = new Map<string, { count: number; amount: number }>();
    for (const e of initial) {
      const cur = map.get(e.category) ?? { count: 0, amount: 0 };
      cur.count += 1;
      cur.amount += e.amountKobo;
      map.set(e.category, cur);
    }
    return [...map.entries()]
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => b.amount - a.amount);
  }, [initial]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return initial.filter((e) => {
      if (categoryFilter !== "all" && e.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        (e.vendor?.toLowerCase().includes(q) ?? false) ||
        (e.description?.toLowerCase().includes(q) ?? false) ||
        categoryLabel(e.category).toLowerCase().includes(q)
      );
    });
  }, [initial, search, categoryFilter]);

  const hasAny = initial.length > 0;
  const isCurrentMonth = nextMonth === null;

  return (
    <div className="space-y-4">
      {/* Which month, and the one bold action */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex items-center gap-1 rounded-lg border border-ink-200 bg-surface p-1">
          <Link
            href={`/expenses?month=${prevMonth}`}
            className="btn btn-icon btn-sm text-ink-600 hover:bg-ink-50"
            aria-label="Previous month"
          >
            <ChevronLeft className="size-4" />
          </Link>
          <span className="min-w-[8.5rem] text-center text-sm font-semibold text-ink-900">
            {monthLabel}
          </span>
          {nextMonth ? (
            <Link
              href={`/expenses?month=${nextMonth}`}
              className="btn btn-icon btn-sm text-ink-600 hover:bg-ink-50"
              aria-label="Next month"
            >
              <ChevronRight className="size-4" />
            </Link>
          ) : (
            <span
              aria-hidden
              className="btn btn-icon btn-sm cursor-not-allowed text-ink-300"
            >
              <ChevronRight className="size-4" />
            </span>
          )}
        </div>

        {canManage && (
          <button type="button" onClick={() => setEditing("new")} className="btn btn-primary">
            <Plus className="size-4" />
            Add expense
          </button>
        )}
      </div>

      {/* The headline figure for the month */}
      <div className="card card-pad">
        <p className="text-sm text-ink-500">Spent in {monthLabel}</p>
        <p className="mt-1 text-3xl font-bold tracking-tight text-ink-950">
          {formatNaira(totalKobo)}
        </p>
        <p className="mt-0.5 text-xs text-ink-400">
          {initial.length} {initial.length === 1 ? "entry" : "entries"}
        </p>
      </div>

      {hasAny && (
        <>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by who you paid or a note"
              className="input h-10 w-full pl-9"
              aria-label="Search expenses"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <FilterChip
              label="All"
              count={initial.length}
              active={categoryFilter === "all"}
              onClick={() => setCategoryFilter("all")}
            />
            {byCategory.map((c) => (
              <FilterChip
                key={c.key}
                label={categoryLabel(c.key)}
                count={c.count}
                active={categoryFilter === c.key}
                onClick={() => setCategoryFilter(c.key)}
              />
            ))}
          </div>
        </>
      )}

      {/* The list */}
      {!hasAny ? (
        <EmptyExpenses
          monthLabel={monthLabel}
          canAdd={canManage && isCurrentMonth}
          onAdd={() => setEditing("new")}
        />
      ) : filtered.length === 0 ? (
        <p className="card card-pad text-center text-sm text-ink-500">
          No expense matches your search.
        </p>
      ) : (
        <div className="card overflow-hidden">
          {/* Desktop: a ledger. Mobile: the same rows, stacked. */}
          <div className="hidden sm:block">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Category</th>
                  <th>Details</th>
                  <th>Paid</th>
                  <th data-numeric>Amount</th>
                  {canManage && <th className="w-0" />}
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap text-ink-600">
                      {fmtDate.format(new Date(e.expenseDate))}
                    </td>
                    <td>
                      <span className="badge badge-neutral">{categoryLabel(e.category)}</span>
                    </td>
                    <td>
                      <span className="text-ink-800">{e.vendor ?? "—"}</span>
                      {e.description && (
                        <span className="block max-w-[22rem] truncate text-xs text-ink-400">
                          {e.description}
                        </span>
                      )}
                      {multiBranch && branchName(e.branchId) && (
                        <span className="block text-xs text-ink-400">
                          {branchName(e.branchId)}
                        </span>
                      )}
                    </td>
                    <td className="text-ink-500">
                      {METHOD_LABELS[e.paymentMethod] ?? e.paymentMethod}
                    </td>
                    <td data-numeric className="tabular font-semibold text-ink-900">
                      {formatNaira(e.amountKobo)}
                    </td>
                    {canManage && (
                      <td className="text-right">
                        <button
                          type="button"
                          onClick={() => setEditing(e)}
                          className="btn btn-icon btn-sm text-ink-500 hover:text-ink-900"
                          aria-label="Edit expense"
                        >
                          <Pencil className="size-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="divide-y divide-hairline sm:hidden">
            {filtered.map((e) => {
              const body = (
                <>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="badge badge-neutral shrink-0">
                        {categoryLabel(e.category)}
                      </span>
                      <span className="truncate text-sm text-ink-700">{e.vendor ?? ""}</span>
                    </div>
                    <span className="mt-1 block text-xs text-ink-400">
                      {fmtDate.format(new Date(e.expenseDate))} ·{" "}
                      {METHOD_LABELS[e.paymentMethod] ?? e.paymentMethod}
                    </span>
                    {e.description && (
                      <span className="block truncate text-xs text-ink-400">{e.description}</span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="tabular font-semibold text-ink-900">
                      {formatNaira(e.amountKobo)}
                    </span>
                    {canManage && <Pencil className="size-4 text-ink-300" />}
                  </div>
                </>
              );
              return (
                <li key={e.id}>
                  {canManage ? (
                    <button
                      type="button"
                      onClick={() => setEditing(e)}
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

      {editing && (
        <ExpenseSheet
          expense={editing === "new" ? null : editing}
          branches={branches}
          defaultBranchId={defaultBranchId}
          multiBranch={multiBranch}
          timezone={timezone}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function EmptyExpenses({
  monthLabel,
  canAdd,
  onAdd,
}: {
  monthLabel: string;
  canAdd: boolean;
  onAdd: () => void;
}) {
  return (
    <div className="card card-pad text-center">
      <div className="mx-auto mb-3 grid size-11 place-items-center rounded-full bg-ink-50">
        <Receipt className="size-5 text-ink-400" />
      </div>
      <p className="text-sm font-semibold text-ink-900">Nothing recorded in {monthLabel}</p>
      <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-ink-500">
        {canAdd
          ? "Log rent, light, transport and the other running costs here. They sit beside your sales so the month actually adds up."
          : "No running costs were logged for this month."}
      </p>
      {canAdd && (
        <button type="button" onClick={onAdd} className="btn btn-primary mt-4">
          <Plus className="size-4" />
          Add an expense
        </button>
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

// ─────────────────────────────────────────────────────────────────────────────
// Add / edit sheet
// ─────────────────────────────────────────────────────────────────────────────

interface FormState {
  category: string;
  amount: string; // naira, as typed
  date: string; // YYYY-MM-DD
  method: string;
  vendor: string;
  branchId: string;
  description: string;
}

function toForm(
  e: ExpenseRow | null,
  defaultBranchId: string,
  timezone: string,
): FormState {
  return {
    category: e?.category ?? "",
    amount: e ? String(e.amountKobo / 100) : "",
    date: e ? isoDateInTz(e.expenseDate, timezone) : todayInTz(timezone),
    method: e?.paymentMethod ?? "CASH",
    vendor: e?.vendor ?? "",
    branchId: e?.branchId ?? defaultBranchId,
    description: e?.description ?? "",
  };
}

function ExpenseSheet({
  expense,
  branches,
  defaultBranchId,
  multiBranch,
  timezone,
  onClose,
  onSaved,
}: {
  expense: ExpenseRow | null;
  branches: Branch[];
  defaultBranchId: string;
  multiBranch: boolean;
  timezone: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState>(() =>
    toForm(expense, defaultBranchId, timezone),
  );
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const amountRef = useRef<HTMLInputElement>(null);

  const busy = saving || deleting;

  useEffect(() => {
    requestAnimationFrame(() => amountRef.current?.focus());
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const today = todayInTz(timezone);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;

    // Catch the two obvious gaps before a round trip.
    const next: Record<string, string> = {};
    if (!form.category) next.category = "Pick a category.";
    const amountKobo = kobo(form.amount);
    if (amountKobo <= 0) next.amountKobo = "Enter how much you spent.";
    if (Object.keys(next).length > 0) {
      setFieldErrors(next);
      return;
    }

    setSaving(true);
    setError(null);
    setFieldErrors({});

    const url = expense ? `/api/expenses/${expense.id}` : "/api/expenses";
    const method = expense ? "PUT" : "POST";

    try {
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          category: form.category,
          amountKobo,
          description: form.description.trim() || undefined,
          vendor: form.vendor.trim() || undefined,
          paymentMethod: form.method,
          branchId: multiBranch ? form.branchId || undefined : undefined,
          expenseDate: form.date || undefined,
        }),
      });
      if (res.ok) {
        onSaved();
        return;
      }
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        fields?: Record<string, string>;
      };
      setError(data.error ?? "Couldn't save. Please try again.");
      if (data.fields) setFieldErrors(data.fields);
      setSaving(false);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
      setSaving(false);
    }
  }

  async function remove() {
    if (!expense || busy) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/expenses/${expense.id}`, { method: "DELETE" });
      if (res.ok) {
        onSaved();
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Couldn't delete this expense. Please try again.");
      setDeleting(false);
      setConfirmDelete(false);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/50 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <form
        onSubmit={submit}
        className="animate-slide-up flex max-h-[94vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-surface shadow-xl sm:rounded-2xl"
      >
        <div className="flex items-center justify-between border-b border-hairline p-4">
          <h2 className="text-base font-bold text-ink-950">
            {expense ? "Edit expense" : "New expense"}
          </h2>
          <button
            type="button"
            onClick={() => !busy && onClose()}
            className="btn btn-icon text-ink-500 hover:text-ink-900"
            aria-label="Close"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Category" error={fieldErrors.category}>
              <select
                value={form.category}
                onChange={(e) => set("category", e.target.value)}
                className="select"
                aria-invalid={Boolean(fieldErrors.category)}
              >
                <option value="" disabled>
                  Choose…
                </option>
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {EXPENSE_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Amount" error={fieldErrors.amountKobo}>
              <div
                className={`flex h-11 items-center rounded-lg border bg-surface focus-within:ring-3 focus-within:ring-brand-100 ${
                  fieldErrors.amountKobo
                    ? "border-bad-500"
                    : "border-ink-200 focus-within:border-brand-700"
                }`}
              >
                <span className="pl-3 text-sm text-ink-400">₦</span>
                <input
                  ref={amountRef}
                  value={form.amount}
                  onChange={(e) => {
                    set("amount", e.target.value);
                    if (fieldErrors.amountKobo) {
                      setFieldErrors((f) => ({ ...f, amountKobo: "" }));
                    }
                  }}
                  onBlur={() => {
                    const parsed = parseMoneyInput(form.amount);
                    if (!Number.isNaN(parsed) && parsed > 0) set("amount", String(parsed));
                  }}
                  className="w-full bg-transparent px-2 text-[0.9375rem] text-ink-900 outline-none"
                  inputMode="decimal"
                  placeholder="0"
                  autoComplete="off"
                  aria-invalid={Boolean(fieldErrors.amountKobo)}
                />
              </div>
            </Field>

            <Field label="Date">
              <input
                type="date"
                value={form.date}
                max={today}
                onChange={(e) => set("date", e.target.value)}
                className="input"
              />
            </Field>

            <Field label="Paid with">
              <select
                value={form.method}
                onChange={(e) => set("method", e.target.value)}
                className="select"
              >
                {Object.entries(METHOD_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Paid to" hint="Optional" className="sm:col-span-2">
              <input
                value={form.vendor}
                onChange={(e) => set("vendor", e.target.value)}
                className="input"
                placeholder="e.g. landlord, NEPA, Mallam Sule"
                maxLength={160}
              />
            </Field>

            {multiBranch && (
              <Field label="Branch" className="sm:col-span-2" error={fieldErrors.branchId}>
                <select
                  value={form.branchId}
                  onChange={(e) => set("branchId", e.target.value)}
                  className="select"
                >
                  <option value="">Whole business</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            <Field label="Note" hint="Optional" className="sm:col-span-2">
              <textarea
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                className="input min-h-20 resize-y"
                placeholder="What it was for — e.g. two weeks' diesel for the generator"
                maxLength={300}
              />
            </Field>
          </div>

          {error && (
            <p className="rounded-lg bg-bad-50 px-3 py-2 text-sm text-bad-700">{error}</p>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-hairline p-4">
          {expense && (
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className={`btn btn-sm mr-auto ${
                confirmDelete ? "btn-danger" : "btn-ghost text-bad-700 hover:bg-bad-50"
              }`}
            >
              <Trash2 className="size-4" />
              {deleting ? "Deleting…" : confirmDelete ? "Tap again to delete" : "Delete"}
            </button>
          )}
          <button
            type="button"
            onClick={() => !busy && onClose()}
            className="btn btn-outline"
            disabled={busy}
          >
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {saving ? "Saving…" : expense ? "Save changes" : "Add expense"}
          </button>
        </div>
      </form>
    </div>
  );
}

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
    <label className={`block ${className ?? ""}`}>
      <span className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-ink-800">{label}</span>
        {hint && !error && <span className="text-xs text-ink-400">{hint}</span>}
      </span>
      {children}
      {error && <span className="mt-1 block text-xs font-medium text-bad-700">{error}</span>}
    </label>
  );
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

function isoDateInTz(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}
