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
  Package,
  X,
  Store,
} from "lucide-react";

import { formatNaira } from "@/lib/money";
import { SUPPLIER_TYPE_LABELS, type SupplierType } from "@/lib/constants";

export interface SupplierRow {
  id: string;
  name: string;
  type: string;
  marketName: string | null;
  location: string | null;
  address: string | null;
  contactPerson: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  notes: string | null;
  balanceKobo: number;
  isActive: boolean;
  productCount: number;
  purchaseCount: number;
}

const TYPE_OPTIONS = Object.entries(SUPPLIER_TYPE_LABELS) as [SupplierType, string][];

export function SuppliersClient({
  initial,
  canManage,
  totalOwedKobo,
}: {
  initial: SupplierRow[];
  canManage: boolean;
  totalOwedKobo: number;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<SupplierRow | "new" | null>(null);

  // No local copy of the list: this component is a pure projection of what the
  // server sent. Mutations call router.refresh(), which re-renders with fresh
  // `initial` — so there's nothing to keep in sync and no stale state to drift.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return initial.filter((r) => {
      if (!r.isActive && !showInactive) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        (r.marketName?.toLowerCase().includes(q) ?? false) ||
        (r.location?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [initial, search, showInactive]);

  const inactiveCount = initial.filter((r) => !r.isActive).length;
  const hasAny = initial.length > 0;

  return (
    <div className="space-y-4">
      {/* Toolbar: search, the owed summary, and the one bold action */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, market or town"
            className="input h-10 w-full pl-9"
            aria-label="Search suppliers"
          />
        </div>

        {totalOwedKobo > 0 && (
          <span className="badge badge-warn whitespace-nowrap">
            You owe {formatNaira(totalOwedKobo)}
          </span>
        )}

        {canManage && (
          <button type="button" onClick={() => setEditing("new")} className="btn btn-primary">
            <Plus className="size-4" />
            Add supplier
          </button>
        )}
      </div>

      {inactiveCount > 0 && (
        <button
          type="button"
          onClick={() => setShowInactive((v) => !v)}
          className="text-xs font-semibold text-ink-500 underline-offset-2 hover:text-ink-800 hover:underline"
        >
          {showInactive ? "Hide" : "Show"} {inactiveCount} inactive
        </button>
      )}

      {/* The list */}
      {!hasAny ? (
        <EmptySuppliers canManage={canManage} onAdd={() => setEditing("new")} />
      ) : filtered.length === 0 ? (
        <p className="card card-pad text-center text-sm text-ink-500">
          No supplier matches &ldquo;{search}&rdquo;.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filtered.map((s) => (
            <SupplierCard
              key={s.id}
              supplier={s}
              canManage={canManage}
              onEdit={() => setEditing(s)}
            />
          ))}
        </div>
      )}

      {editing && (
        <SupplierSheet
          supplier={editing === "new" ? null : editing}
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

// ─────────────────────────────────────────────────────────────────────────────
// One supplier
// ─────────────────────────────────────────────────────────────────────────────

function SupplierCard({
  supplier: s,
  canManage,
  onEdit,
}: {
  supplier: SupplierRow;
  canManage: boolean;
  onEdit: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const where = [s.marketName, s.location].filter(Boolean).join(" · ");
  const typeLabel = SUPPLIER_TYPE_LABELS[s.type as SupplierType] ?? s.type;

  async function toggleActive() {
    setBusy(true);
    try {
      if (s.isActive) {
        await fetch(`/api/suppliers/${s.id}`, { method: "DELETE" });
      } else {
        // Reactivate: a full PUT, so send the fields the schema requires.
        await fetch(`/api/suppliers/${s.id}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: s.name,
            type: s.type,
            marketName: s.marketName,
            location: s.location,
            address: s.address,
            contactPerson: s.contactPerson,
            phone: s.phone,
            whatsapp: s.whatsapp,
            email: s.email,
            notes: s.notes,
            isActive: true,
          }),
        });
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`card card-pad flex flex-col gap-3 ${s.isActive ? "" : "opacity-60"}`}>
      <div className="flex items-start gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-ink-100 text-ink-500">
          <Store className="size-[1.125rem]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-bold text-ink-950">{s.name}</p>
            {!s.isActive && <span className="badge badge-neutral shrink-0">Inactive</span>}
          </div>
          <p className="truncate text-xs text-ink-500">{typeLabel}</p>
        </div>
        {s.balanceKobo > 0 && (
          <span className="badge badge-warn shrink-0" title="Outstanding balance you owe">
            {formatNaira(s.balanceKobo)}
          </span>
        )}
      </div>

      {where && (
        <p className="flex items-center gap-1.5 text-sm text-ink-600">
          <MapPin className="size-4 shrink-0 text-ink-400" />
          <span className="truncate">{where}</span>
        </p>
      )}

      {(s.phone || s.whatsapp || s.email) && (
        <div className="flex flex-wrap gap-1.5">
          {s.phone && (
            <a href={`tel:${s.phone}`} className="contact-chip" aria-label={`Call ${s.name}`}>
              <Phone className="size-3.5" />
              {s.phone}
            </a>
          )}
          {s.whatsapp && (
            <a
              href={`https://wa.me/${s.whatsapp.replace(/\D/g, "")}`}
              target="_blank"
              rel="noopener noreferrer"
              className="contact-chip"
              aria-label={`WhatsApp ${s.name}`}
            >
              <MessageCircle className="size-3.5" />
              WhatsApp
            </a>
          )}
          {s.email && (
            <a href={`mailto:${s.email}`} className="contact-chip" aria-label={`Email ${s.name}`}>
              <Mail className="size-3.5" />
              Email
            </a>
          )}
        </div>
      )}

      <div className="mt-auto flex items-center justify-between border-t border-hairline pt-2.5">
        <span className="inline-flex items-center gap-1.5 text-xs text-ink-500">
          <Package className="size-3.5" />
          {s.productCount} product{s.productCount === 1 ? "" : "s"}
          {s.purchaseCount > 0 && ` · ${s.purchaseCount} order${s.purchaseCount === 1 ? "" : "s"}`}
        </span>
        {canManage && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onEdit}
              className="btn btn-icon btn-sm text-ink-500 hover:text-ink-900"
              aria-label={`Edit ${s.name}`}
            >
              <Pencil className="size-4" />
            </button>
            <button
              type="button"
              onClick={toggleActive}
              disabled={busy}
              className="btn btn-icon btn-sm text-ink-500 hover:text-ink-900 disabled:opacity-50"
              aria-label={s.isActive ? `Deactivate ${s.name}` : `Reactivate ${s.name}`}
              title={s.isActive ? "Deactivate" : "Reactivate"}
            >
              {s.isActive ? <Trash2 className="size-4" /> : <RotateCcw className="size-4" />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function EmptySuppliers({ canManage, onAdd }: { canManage: boolean; onAdd: () => void }) {
  return (
    <div className="card card-pad text-center">
      <div className="mx-auto mb-3 grid size-11 place-items-center rounded-full bg-ink-50">
        <Store className="size-5 text-ink-400" />
      </div>
      <p className="text-sm font-semibold text-ink-900">No suppliers yet</p>
      <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-ink-500">
        Add the markets, distributors and shops you buy stock from. You&rsquo;ll pick one each time
        you record goods received.
      </p>
      {canManage && (
        <button type="button" onClick={onAdd} className="btn btn-primary mt-4">
          <Plus className="size-4" />
          Add your first supplier
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
  type: string;
  marketName: string;
  location: string;
  address: string;
  contactPerson: string;
  phone: string;
  whatsapp: string;
  email: string;
  notes: string;
}

function toForm(s: SupplierRow | null): FormState {
  return {
    name: s?.name ?? "",
    type: s?.type ?? "MARKET",
    marketName: s?.marketName ?? "",
    location: s?.location ?? "",
    address: s?.address ?? "",
    contactPerson: s?.contactPerson ?? "",
    phone: s?.phone ?? "",
    whatsapp: s?.whatsapp ?? "",
    email: s?.email ?? "",
    notes: s?.notes ?? "",
  };
}

function SupplierSheet({
  supplier,
  onClose,
  onSaved,
}: {
  supplier: SupplierRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState>(() => toForm(supplier));
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

    const url = supplier ? `/api/suppliers/${supplier.id}` : "/api/suppliers";
    const method = supplier ? "PUT" : "POST";

    try {
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
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
            {supplier ? "Edit supplier" : "New supplier"}
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
                placeholder="e.g. Mama Nkechi Provisions"
                maxLength={160}
              />
            </Field>

            <Field label="Type">
              <select
                value={form.type}
                onChange={(e) => set("type", e.target.value)}
                className="select"
              >
                {TYPE_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Market" hint="If you buy from a market">
              <input
                value={form.marketName}
                onChange={(e) => set("marketName", e.target.value)}
                className="input"
                placeholder="e.g. Mile 12 Market"
                maxLength={120}
              />
            </Field>

            <Field label="Town / area">
              <input
                value={form.location}
                onChange={(e) => set("location", e.target.value)}
                className="input"
                placeholder="e.g. Ketu, Lagos"
                maxLength={120}
              />
            </Field>

            <Field label="Contact person">
              <input
                value={form.contactPerson}
                onChange={(e) => set("contactPerson", e.target.value)}
                className="input"
                placeholder="Who you deal with"
                maxLength={120}
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

            <Field label="Notes" className="sm:col-span-2">
              <textarea
                value={form.notes}
                onChange={(e) => set("notes", e.target.value)}
                className="input min-h-20 resize-y"
                placeholder="Anything worth remembering — delivery days, haggling notes…"
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
            {saving ? "Saving…" : supplier ? "Save changes" : "Add supplier"}
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
