"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Search,
  MapPin,
  Phone,
  MessageCircle,
  Mail,
  Pencil,
  Trash2,
  RotateCcw,
  X,
  User,
  Wallet,
} from "lucide-react";

import { formatNaira, parseMoneyInput } from "@/lib/money";

export interface CustomerRow {
  id: string;
  name: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  creditLimitKobo: number;
  balanceKobo: number;
  totalSpentKobo: number;
  purchaseCount: number;
  lastPurchaseAt: string | null; // ISO
  isActive: boolean;
}

type Filter = "all" | "owing";

const METHOD_LABELS: Record<string, string> = {
  CASH: "Cash",
  TRANSFER: "Bank transfer",
  POS: "Card / POS",
  CHEQUE: "Cheque",
};

export function CustomersClient({
  initial,
  canManage,
  canRecordDebt,
  totalOwedKobo,
  timezone,
}: {
  initial: CustomerRow[];
  canManage: boolean;
  canRecordDebt: boolean;
  totalOwedKobo: number;
  timezone: string;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<CustomerRow | "new" | null>(null);
  const [paying, setPaying] = useState<CustomerRow | null>(null);

  const fmtDate = useMemo(
    () => new Intl.DateTimeFormat("en-NG", { timeZone: timezone, dateStyle: "medium" }),
    [timezone],
  );

  // This component is a pure projection of what the server sent: no local copy of
  // the list, so mutations just call router.refresh() and nothing can drift.
  const base = useMemo(
    () => initial.filter((r) => r.isActive || showInactive),
    [initial, showInactive],
  );

  const counts = useMemo(
    () => ({
      all: base.length,
      owing: base.filter((r) => r.balanceKobo > 0).length,
    }),
    [base],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return base.filter((r) => {
      if (filter === "owing" && r.balanceKobo <= 0) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        (r.phone?.toLowerCase().includes(q) ?? false) ||
        (r.whatsapp?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [base, search, filter]);

  const inactiveCount = initial.filter((r) => !r.isActive).length;
  const hasAny = initial.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or phone"
            className="input h-10 w-full pl-9"
            aria-label="Search customers"
          />
        </div>

        {totalOwedKobo > 0 && (
          <span className="badge badge-warn whitespace-nowrap" title="Total owed to you across all customers">
            You&rsquo;re owed {formatNaira(totalOwedKobo)}
          </span>
        )}

        {canManage && (
          <button type="button" onClick={() => setEditing("new")} className="btn btn-primary">
            <Plus className="size-4" />
            Add customer
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <FilterChip label="All" count={counts.all} active={filter === "all"} onClick={() => setFilter("all")} />
        <FilterChip label="Owing" count={counts.owing} active={filter === "owing"} onClick={() => setFilter("owing")} />

        {inactiveCount > 0 && (
          <button
            type="button"
            onClick={() => setShowInactive((v) => !v)}
            className="ml-auto text-xs font-semibold text-ink-500 underline-offset-2 hover:text-ink-800 hover:underline"
          >
            {showInactive ? "Hide" : "Show"} {inactiveCount} inactive
          </button>
        )}
      </div>

      {!hasAny ? (
        <EmptyCustomers canManage={canManage} onAdd={() => setEditing("new")} />
      ) : filtered.length === 0 ? (
        <p className="card card-pad text-center text-sm text-ink-500">
          {filter === "owing" && !search
            ? "No one owes you right now — every account is settled."
            : search
              ? `No customer matches “${search}”.`
              : "No customers to show."}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filtered.map((c) => (
            <CustomerCard
              key={c.id}
              customer={c}
              canManage={canManage}
              canRecordDebt={canRecordDebt}
              fmtDate={fmtDate}
              onEdit={() => setEditing(c)}
              onPay={() => setPaying(c)}
            />
          ))}
        </div>
      )}

      {editing && (
        <CustomerSheet
          customer={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}

      {paying && (
        <PaySheet
          customerId={paying.id}
          customerName={paying.name}
          balanceKobo={paying.balanceKobo}
          timezone={timezone}
          onClose={() => setPaying(null)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// One customer
// ─────────────────────────────────────────────────────────────────────────────

function CustomerCard({
  customer: c,
  canManage,
  canRecordDebt,
  fmtDate,
  onEdit,
  onPay,
}: {
  customer: CustomerRow;
  canManage: boolean;
  canRecordDebt: boolean;
  fmtDate: Intl.DateTimeFormat;
  onEdit: () => void;
  onPay: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggleActive() {
    setBusy(true);
    try {
      if (c.isActive) {
        await fetch(`/api/customers/${c.id}`, { method: "DELETE" });
      } else {
        // Reactivate: a full PUT, so send the fields the schema requires.
        await fetch(`/api/customers/${c.id}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: c.name,
            phone: c.phone,
            whatsapp: c.whatsapp,
            email: c.email,
            address: c.address,
            notes: c.notes,
            creditLimitKobo: c.creditLimitKobo,
            isActive: true,
          }),
        });
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const meta =
    c.purchaseCount > 0
      ? `${formatNaira(c.totalSpentKobo)} spent · ${c.purchaseCount} sale${c.purchaseCount === 1 ? "" : "s"}`
      : "No purchases yet";

  return (
    <div className={`card card-pad flex flex-col gap-3 ${c.isActive ? "" : "opacity-60"}`}>
      <div className="flex items-start gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-ink-100 text-ink-500">
          <User className="size-[1.125rem]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-bold text-ink-950">{c.name}</p>
            {!c.isActive && <span className="badge badge-neutral shrink-0">Inactive</span>}
          </div>
          {c.lastPurchaseAt && (
            <p className="truncate text-xs text-ink-500">
              Last bought {fmtDate.format(new Date(c.lastPurchaseAt))}
            </p>
          )}
        </div>
      </div>

      {c.address && (
        <p className="flex items-center gap-1.5 text-sm text-ink-600">
          <MapPin className="size-4 shrink-0 text-ink-400" />
          <span className="truncate">{c.address}</span>
        </p>
      )}

      {(c.phone || c.whatsapp || c.email) && (
        <div className="flex flex-wrap gap-1.5">
          {c.phone && (
            <a href={`tel:${c.phone}`} className="contact-chip" aria-label={`Call ${c.name}`}>
              <Phone className="size-3.5" />
              {c.phone}
            </a>
          )}
          {c.whatsapp && (
            <a
              href={`https://wa.me/${c.whatsapp.replace(/\D/g, "")}`}
              target="_blank"
              rel="noopener noreferrer"
              className="contact-chip"
              aria-label={`WhatsApp ${c.name}`}
            >
              <MessageCircle className="size-3.5" />
              WhatsApp
            </a>
          )}
          {c.email && (
            <a href={`mailto:${c.email}`} className="contact-chip" aria-label={`Email ${c.name}`}>
              <Mail className="size-3.5" />
              Email
            </a>
          )}
        </div>
      )}

      {/* Debt is the headline on this screen — give it its own strip with the action */}
      {c.balanceKobo > 0 && (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-warn-50 px-3 py-2">
          <span className="text-sm text-warn-700">
            Owes <span className="font-bold">{formatNaira(c.balanceKobo)}</span>
          </span>
          {canRecordDebt && c.isActive && (
            <button type="button" onClick={onPay} className="btn btn-primary btn-sm">
              <Wallet className="size-3.5" />
              Record payment
            </button>
          )}
        </div>
      )}

      <div className="mt-auto flex items-center justify-between border-t border-hairline pt-2.5">
        <span className="truncate text-xs text-ink-500">{meta}</span>
        {canManage && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={onEdit}
              className="btn btn-icon btn-sm text-ink-500 hover:text-ink-900"
              aria-label={`Edit ${c.name}`}
            >
              <Pencil className="size-4" />
            </button>
            <button
              type="button"
              onClick={toggleActive}
              disabled={busy}
              className="btn btn-icon btn-sm text-ink-500 hover:text-ink-900 disabled:opacity-50"
              aria-label={c.isActive ? `Deactivate ${c.name}` : `Reactivate ${c.name}`}
              title={c.isActive ? "Deactivate" : "Reactivate"}
            >
              {c.isActive ? <Trash2 className="size-4" /> : <RotateCcw className="size-4" />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyCustomers({ canManage, onAdd }: { canManage: boolean; onAdd: () => void }) {
  return (
    <div className="card card-pad text-center">
      <div className="mx-auto mb-3 grid size-11 place-items-center rounded-full bg-ink-50">
        <User className="size-5 text-ink-400" />
      </div>
      <p className="text-sm font-semibold text-ink-900">No customers yet</p>
      <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-ink-500">
        Add the regulars and anyone who buys on credit. You&rsquo;ll pick them at the till, and their
        running balance shows up here.
      </p>
      {canManage && (
        <button type="button" onClick={onAdd} className="btn btn-primary mt-4">
          <Plus className="size-4" />
          Add your first customer
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Add / edit sheet
// ─────────────────────────────────────────────────────────────────────────────

interface FormState {
  name: string;
  phone: string;
  whatsapp: string;
  email: string;
  address: string;
  creditLimit: string; // naira, as typed
  notes: string;
}

function toForm(c: CustomerRow | null): FormState {
  return {
    name: c?.name ?? "",
    phone: c?.phone ?? "",
    whatsapp: c?.whatsapp ?? "",
    email: c?.email ?? "",
    address: c?.address ?? "",
    creditLimit: c?.creditLimitKobo ? String(c.creditLimitKobo / 100) : "",
    notes: c?.notes ?? "",
  };
}

function CustomerSheet({
  customer,
  onClose,
  onSaved,
}: {
  customer: CustomerRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState>(() => toForm(customer));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => nameRef.current?.focus());
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !saving) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [saving, onClose]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    setFieldErrors({});

    const url = customer ? `/api/customers/${customer.id}` : "/api/customers";
    const method = customer ? "PUT" : "POST";

    try {
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          phone: form.phone,
          whatsapp: form.whatsapp,
          email: form.email,
          address: form.address,
          notes: form.notes,
          creditLimitKobo: kobo(form.creditLimit),
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
        <div className="flex items-center justify-between border-b border-hairline p-4">
          <h2 className="text-base font-bold text-ink-950">
            {customer ? "Edit customer" : "New customer"}
          </h2>
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
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" error={fieldErrors.name} className="sm:col-span-2">
              <input
                ref={nameRef}
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                className="input"
                placeholder="e.g. Chidi Okafor"
                maxLength={160}
              />
            </Field>

            <Field label="Phone" error={fieldErrors.phone}>
              <input
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
                className="input"
                inputMode="tel"
                placeholder="080..."
                maxLength={40}
              />
            </Field>

            <Field label="WhatsApp">
              <input
                value={form.whatsapp}
                onChange={(e) => set("whatsapp", e.target.value)}
                className="input"
                inputMode="tel"
                placeholder="080..."
                maxLength={40}
              />
            </Field>

            <Field label="Email" error={fieldErrors.email} className="sm:col-span-2">
              <input
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
                className="input"
                inputMode="email"
                placeholder="Optional"
                maxLength={160}
              />
            </Field>

            <Field label="Address" className="sm:col-span-2">
              <input
                value={form.address}
                onChange={(e) => set("address", e.target.value)}
                className="input"
                placeholder="Shop or home address"
                maxLength={240}
              />
            </Field>

            <Field
              label="Credit limit"
              hint="Most they can owe · 0 = no limit"
              error={fieldErrors.creditLimitKobo}
              className="sm:col-span-2"
            >
              <div className="flex h-11 items-center rounded-lg border border-ink-200 bg-surface focus-within:border-brand-700 focus-within:ring-3 focus-within:ring-brand-100">
                <span className="pl-3 text-sm text-ink-400">₦</span>
                <input
                  value={form.creditLimit}
                  onChange={(e) => set("creditLimit", e.target.value)}
                  onBlur={() => {
                    const parsed = parseMoneyInput(form.creditLimit);
                    set("creditLimit", Number.isNaN(parsed) || parsed <= 0 ? "" : String(parsed));
                  }}
                  className="w-full bg-transparent px-2 text-[0.9375rem] text-ink-900 outline-none"
                  inputMode="decimal"
                  placeholder="0"
                  autoComplete="off"
                />
              </div>
            </Field>

            <Field label="Notes" className="sm:col-span-2">
              <textarea
                value={form.notes}
                onChange={(e) => set("notes", e.target.value)}
                className="input min-h-20 resize-y"
                placeholder="Anything worth remembering — where they work, who referred them…"
                maxLength={2000}
              />
            </Field>
          </div>

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
            {saving ? "Saving…" : customer ? "Save changes" : "Add customer"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Record payment
// ─────────────────────────────────────────────────────────────────────────────

function PaySheet({
  customerId,
  customerName,
  balanceKobo,
  timezone,
  onClose,
}: {
  customerId: string;
  customerName: string;
  balanceKobo: number;
  timezone: string;
  onClose: () => void;
}) {
  const router = useRouter();

  // Prefill the full balance — clearing the tab is the common case, and it's
  // easier to lower a figure than to type one.
  const [amount, setAmount] = useState(() => String(balanceKobo / 100));
  const [method, setMethod] = useState("CASH");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
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
      setFieldError("Enter how much they paid.");
      return;
    }
    if (amountKobo > balanceKobo) {
      setFieldError("That's more than they owe.");
      return;
    }

    setSaving(true);
    setError(null);
    setFieldError(null);
    try {
      const res = await fetch(`/api/customers/${customerId}/pay`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amountKobo,
          method,
          reference: reference.trim() || undefined,
          note: note.trim() || undefined,
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
        <div className="flex items-start justify-between border-b border-hairline p-4">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-ink-950">Record payment</h2>
            <p className="truncate text-sm text-ink-500">{customerName}</p>
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
                fieldError ? "border-bad-500" : "border-ink-200 focus-within:border-brand-700"
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
            <span className="mb-1 block text-sm font-semibold text-ink-800">How they paid</span>
            <select value={method} onChange={(e) => setMethod(e.target.value)} className="select">
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
            <span className="mb-1 flex items-baseline justify-between">
              <span className="text-sm font-semibold text-ink-800">Note</span>
              <span className="text-xs text-ink-400">Optional</span>
            </span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="input"
              placeholder="e.g. part payment, balance Friday"
              maxLength={500}
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
// Bits
// ─────────────────────────────────────────────────────────────────────────────

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
