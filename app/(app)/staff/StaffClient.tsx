"use client";

import { useMemo, useState } from "react";
import {
  Check,
  Copy,
  KeyRound,
  Loader2,
  MessageCircle,
  Pencil,
  ShieldCheck,
  UserCheck,
  UserPlus,
  UserX,
} from "lucide-react";

import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_GROUPS,
  ROLES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  ROLE_SEAT_BUCKET,
  UNLIMITED,
  type Permission,
  type Role,
} from "@/lib/constants";
import type { SeatSummary, StaffRow } from "@/lib/staff";

import { Field, Sheet } from "@/components/ui/Sheet";

/**
 * Staff management.
 *
 * The screen answers three questions in the order an owner asks them:
 *
 *   1. "How many more people can I add?"   → the seat strip at the top.
 *   2. "Who works here and what can they do?" → the list.
 *   3. "Add / change / remove someone."     → one sheet for add and edit.
 *
 * ACCESS, IN PLAIN WORDS
 * ----------------------
 * Picking a role fills in sensible access for that job. Most owners stop
 * there. "Choose exactly what they can do" opens the full list for the ones
 * who want a storekeeper who can also see reports — but it stays folded away
 * so adding a cashier is four fields, not forty checkboxes.
 */

interface BranchOption {
  id: string;
  name: string;
  isMain: boolean;
}

interface Me {
  id: string;
  role: string;
  permissions: Permission[];
}

interface ApiFailure {
  error?: string;
  fields?: Record<string, string>;
}

interface Reveal {
  name: string;
  email: string | null;
  phone: string | null;
  password: string;
  isNew: boolean;
}

function formatWhen(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-NG", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

const SEAT_LABELS: { kind: "mainAdmin" | "subAdmin" | "cashier"; label: string }[] = [
  { kind: "mainAdmin", label: "Main admins" },
  { kind: "subAdmin", label: "Admins and managers" },
  { kind: "cashier", label: "Cashiers" },
];

export function StaffClient({
  initialStaff,
  initialSeats,
  branches,
  timezone,
  me,
  canManage,
  canSetAccess,
  departmentsOn = false,
}: {
  /** The shop runs a supermarket and a pharmacy side by side. */
  departmentsOn?: boolean;
  initialStaff: StaffRow[];
  initialSeats: SeatSummary;
  branches: BranchOption[];
  timezone: string;
  me: Me;
  canManage: boolean;
  canSetAccess: boolean;
}) {
  const [staff, setStaff] = useState<StaffRow[]>(initialStaff);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<StaffRow | null>(null);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  // Seats are recounted from the list on screen, so the strip moves the moment
  // someone is added or deactivated without another trip to the server.
  const seats = useMemo(() => {
    const used = { mainAdmin: 0, subAdmin: 0, cashier: 0 };
    for (const person of staff) {
      if (!person.isActive) continue;
      const bucket = ROLE_SEAT_BUCKET[person.role];
      if (bucket !== "branches") used[bucket] += 1;
    }
    return {
      mainAdmin: { limit: initialSeats.mainAdmin.limit, used: used.mainAdmin },
      subAdmin: { limit: initialSeats.subAdmin.limit, used: used.subAdmin },
      cashier: { limit: initialSeats.cashier.limit, used: used.cashier },
    };
  }, [staff, initialSeats]);

  /** Same rule the server enforces (lib/permissions.ts → canManageUser). */
  function canChange(person: StaffRow): boolean {
    if (!canManage) return false;
    if (person.id === me.id) return false;
    if (person.role === "MAIN_ADMIN" && me.role !== "MAIN_ADMIN") return false;
    return true;
  }

  function upsert(row: StaffRow) {
    setStaff((current) =>
      current.some((p) => p.id === row.id)
        ? current.map((p) => (p.id === row.id ? row : p))
        : [...current, row],
    );
  }

  async function setActive(person: StaffRow, isActive: boolean) {
    setBusyId(person.id);
    setRowError(null);
    try {
      const res = await fetch(`/api/staff/${person.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      const data = (await res.json().catch(() => ({}))) as ApiFailure & { staff?: StaffRow };
      if (res.ok && data.staff) upsert(data.staff);
      else setRowError({ id: person.id, message: data.error ?? "Couldn't save. Please try again." });
    } catch {
      setRowError({ id: person.id, message: "Couldn't reach the server. Check your connection." });
    } finally {
      setBusyId(null);
    }
  }

  async function resetPassword(person: StaffRow) {
    setBusyId(person.id);
    setRowError(null);
    try {
      const res = await fetch(`/api/staff/${person.id}/reset-password`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as ApiFailure & { tempPassword?: string };
      if (res.ok && data.tempPassword) {
        upsert({ ...person, mustChangePassword: true });
        setReveal({
          name: person.name,
          email: person.email,
          phone: person.phone,
          password: data.tempPassword,
          isNew: false,
        });
      } else {
        setRowError({ id: person.id, message: data.error ?? "Couldn't reset the password." });
      }
    } catch {
      setRowError({ id: person.id, message: "Couldn't reach the server. Check your connection." });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* Seats: how much room is left on the plan. */}
      <div className="grid gap-3 sm:grid-cols-3">
        {SEAT_LABELS.map(({ kind, label }) => {
          const seat = seats[kind];
          const unlimited = seat.limit === UNLIMITED;
          const full = !unlimited && seat.used >= seat.limit;
          const percent = unlimited ? 0 : Math.min(100, (seat.used / Math.max(1, seat.limit)) * 100);
          return (
            <div key={kind} className="card card-pad">
              <p className="text-xs font-bold uppercase tracking-wider text-ink-500">{label}</p>
              <p className="tabular mt-1 text-2xl font-bold text-ink-950">
                {seat.used}
                <span className="text-base font-semibold text-ink-400">
                  {unlimited ? " · no limit" : ` of ${seat.limit}`}
                </span>
              </p>
              {!unlimited ? (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-100">
                  <div
                    className={`h-full rounded-full ${full ? "bg-brand-500" : "bg-navy-600"}`}
                    style={{ width: `${percent}%` }}
                  />
                </div>
              ) : null}
              {full ? <p className="mt-1.5 text-xs font-semibold text-brand-800">All in use</p> : null}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-ink-500">
          {staff.filter((p) => p.isActive).length} active
          {staff.some((p) => !p.isActive) ? ` · ${staff.filter((p) => !p.isActive).length} deactivated` : ""}
        </p>
        {canManage ? (
          <button type="button" onClick={() => setAdding(true)} className="btn btn-primary h-10">
            <UserPlus className="size-4" />
            Add staff
          </button>
        ) : null}
      </div>

      <ul className="card divide-y divide-hairline">
        {staff.map((person) => {
          const isMe = person.id === me.id;
          const changeable = canChange(person);
          const busy = busyId === person.id;
          const waiting = person.isActive && person.mustChangePassword;
          return (
            <li key={person.id} className={`p-4 ${person.isActive ? "" : "bg-ink-50"}`}>
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className={`grid size-10 shrink-0 place-items-center rounded-full text-sm font-bold ${
                    person.isActive ? "bg-navy-700 text-white" : "bg-ink-200 text-ink-600"
                  }`}
                  aria-hidden
                >
                  {initials(person.name)}
                </span>

                <div className="min-w-0 flex-1 basis-48">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-bold text-ink-950">
                    <span className="truncate">{person.name}</span>
                    {isMe ? <span className="badge badge-neutral">You</span> : null}
                    {!person.isActive ? <span className="badge badge-neutral">Deactivated</span> : null}
                    {waiting ? <span className="badge badge-warn">Hasn&apos;t set a password yet</span> : null}
                  </p>
                  <p className="truncate text-sm text-ink-500">
                    {person.email ?? "Signs in with their name"}
                    {person.phone ? ` · ${person.phone}` : ""}
                  </p>
                </div>

                <div className="basis-40 text-sm">
                  <span
                    className={`badge ${person.role === "MAIN_ADMIN" ? "badge-navy" : "badge-info"}`}
                  >
                    {ROLE_LABELS[person.role]}
                  </span>
                  {departmentsOn && person.department ? (
                    <span
                      className={`badge ml-1 ${person.department === "PHARMACY" ? "badge-good" : "badge-info"}`}
                    >
                      {person.department === "PHARMACY" ? "Pharmacy" : "Supermarket"}
                    </span>
                  ) : null}
                  <p className="mt-1 text-xs text-ink-500">
                    {person.branchName ?? "All branches"} ·{" "}
                    {person.lastLoginAt
                      ? `Last signed in ${formatWhen(person.lastLoginAt, timezone)}`
                      : "Not signed in yet"}
                  </p>
                </div>

                {changeable ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {person.isActive ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setEditing(person)}
                          disabled={busy}
                          className="btn btn-outline btn-sm"
                        >
                          <Pencil className="size-4" />
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => void resetPassword(person)}
                          disabled={busy}
                          className="btn btn-outline btn-sm"
                        >
                          {busy ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
                          Reset password
                        </button>
                        <button
                          type="button"
                          onClick={() => void setActive(person, false)}
                          disabled={busy}
                          className="btn btn-ghost btn-sm text-bad-700"
                        >
                          <UserX className="size-4" />
                          Deactivate
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void setActive(person, true)}
                        disabled={busy}
                        className="btn btn-outline btn-sm"
                      >
                        {busy ? <Loader2 className="size-4 animate-spin" /> : <UserCheck className="size-4" />}
                        Reactivate
                      </button>
                    )}
                  </div>
                ) : null}
              </div>

              {rowError?.id === person.id ? (
                <p role="alert" className="mt-2 text-sm font-medium text-bad-700">
                  {rowError.message}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>

      <p className="text-xs leading-relaxed text-ink-500">
        Staff are never deleted, so old sales still show who made them. Deactivating someone stops
        them signing in straight away and frees their place for a replacement.
      </p>

      {adding || editing ? (
        <StaffSheet
          key={editing?.id ?? "new"}
          person={editing}
          branches={branches}
          me={me}
          canSetAccess={canSetAccess}
          departmentsOn={departmentsOn}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSaved={(row, tempPassword) => {
            upsert(row);
            setAdding(false);
            setEditing(null);
            if (tempPassword) {
              setReveal({
                name: row.name,
                email: row.email,
                phone: row.phone,
                password: tempPassword,
                isNew: true,
              });
            }
          }}
        />
      ) : null}

      {reveal ? <PasswordReveal reveal={reveal} onClose={() => setReveal(null)} /> : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Add / edit
// ─────────────────────────────────────────────────────────────────────────────

function sameSet(a: Permission[], b: Permission[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((p) => set.has(p));
}

function StaffSheet({
  person,
  branches,
  me,
  canSetAccess,
  departmentsOn,
  onClose,
  onSaved,
}: {
  departmentsOn: boolean;
  person: StaffRow | null;
  branches: BranchOption[];
  me: Me;
  canSetAccess: boolean;
  onClose: () => void;
  onSaved: (row: StaffRow, tempPassword?: string) => void;
}) {
  const isEdit = person !== null;
  const iAmMain = me.role === "MAIN_ADMIN";

  const [name, setName] = useState(person?.name ?? "");
  const [email, setEmail] = useState(person?.email ?? "");
  const [phone, setPhone] = useState(person?.phone ?? "");
  const [role, setRole] = useState<Role>(person?.role ?? "CASHIER");
  const [branchId, setBranchId] = useState(
    person ? (person.branchId ?? "") : (branches.find((b) => b.isMain)?.id ?? branches[0]?.id ?? ""),
  );
  const [permissions, setPermissions] = useState<Permission[]>(
    person && person.role !== "MAIN_ADMIN" ? person.permissions : DEFAULT_ROLE_PERMISSIONS.CASHIER,
  );
  const startsCustom =
    person !== null &&
    person.role !== "MAIN_ADMIN" &&
    !sameSet(person.permissions, DEFAULT_ROLE_PERMISSIONS[person.role]);
  const [customising, setCustomising] = useState(startsCustom);
  const [department, setDepartment] = useState<string>(person?.department ?? "");
  // Only cashiers and storekeepers are limited to one department.
  const limitable = role === "CASHIER" || role === "STOREKEEPER";
  const [touchedAccess, setTouchedAccess] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const roleOptions = ROLES.filter(
    (r) => r !== "MAIN_ADMIN" || iAmMain || person?.role === "MAIN_ADMIN",
  );

  function pickRole(next: Role) {
    setRole(next);
    // A new role starts from that job's standard access. Carrying a cashier's
    // boxes over to a storekeeper would be wrong in both directions.
    if (next !== "MAIN_ADMIN") setPermissions(DEFAULT_ROLE_PERMISSIONS[next]);
    setCustomising(false);
    setTouchedAccess(false);
  }

  function togglePermission(key: Permission) {
    setTouchedAccess(true);
    setPermissions((current) =>
      current.includes(key) ? current.filter((p) => p !== key) : [...current, key],
    );
  }

  /** A sub-admin can only tick boxes they hold themselves. */
  function grantable(key: Permission): boolean {
    return iAmMain || me.permissions.includes(key);
  }

  async function submit() {
    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      const sendAccess = role !== "MAIN_ADMIN" && canSetAccess && (customising || touchedAccess);
      const body: Record<string, unknown> = {
        name: name.trim(),
        email: email.trim() || null,
        phone: phone.trim() || null,
        role,
        branchId: branchId || null,
        ...(departmentsOn ? { department: limitable ? department : "" } : {}),
      };
      if (sendAccess) body.permissions = permissions;

      const res = await fetch(isEdit ? `/api/staff/${person.id}` : "/api/staff", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as ApiFailure & {
        staff?: StaffRow;
        tempPassword?: string;
      };
      if (res.ok && data.staff) {
        onSaved(data.staff, data.tempPassword);
        return;
      }
      setError(data.error ?? "Couldn't save. Please try again.");
      if (data.fields) setFieldErrors(data.fields);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  const standardCount = role === "MAIN_ADMIN" ? 0 : DEFAULT_ROLE_PERMISSIONS[role].length;

  return (
    <Sheet
      title={isEdit ? `Edit ${person.name}` : "Add staff"}
      subtitle={isEdit ? undefined : "They get a temporary password and choose their own when they first sign in."}
      size="lg"
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-ghost" disabled={saving}>
            Cancel
          </button>
          <button type="button" onClick={submit} className="btn btn-primary" disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            {isEdit ? "Save changes" : "Add and get password"}
          </button>
        </div>
      }
    >
      <div className="space-y-5 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Full name" error={fieldErrors.name} className="sm:col-span-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input"
              placeholder="e.g. Blessing Adeyemi"
              autoFocus={!isEdit}
              maxLength={120}
            />
          </Field>
          <Field
            label="Email"
            hint={role === "MAIN_ADMIN" ? "Required for a main admin" : "Optional. Without one, they sign in with their name"}
            error={fieldErrors.email}
          >
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input"
              placeholder="name@example.com"
              autoComplete="off"
              maxLength={160}
            />
          </Field>
          <Field label="Phone" hint="Optional" error={fieldErrors.phone}>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="input"
              placeholder="0803 000 0000"
              maxLength={30}
            />
          </Field>
        </div>

        <fieldset>
          <legend className="mb-1.5 text-sm font-semibold text-ink-800">What is their job?</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {roleOptions.map((option) => {
              const selected = role === option;
              return (
                <label
                  key={option}
                  className={`flex cursor-pointer gap-2.5 rounded-xl border p-3 transition-colors ${
                    selected ? "border-navy-600 bg-navy-50" : "border-ink-200 hover:border-ink-300"
                  }`}
                >
                  <input
                    type="radio"
                    name="role"
                    className="sr-only"
                    checked={selected}
                    onChange={() => pickRole(option)}
                  />
                  <span
                    className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border ${
                      selected ? "border-navy-700 bg-navy-700" : "border-ink-300 bg-surface"
                    }`}
                    aria-hidden
                  >
                    {selected ? <span className="size-1.5 rounded-full bg-white" /> : null}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-bold text-ink-950">{ROLE_LABELS[option]}</span>
                    <span className="block text-xs leading-relaxed text-ink-600">
                      {ROLE_DESCRIPTIONS[option]}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        {branches.length > 1 ? (
          <Field label="Branch" hint="Where they work" error={fieldErrors.branchId}>
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="select">
              {role !== "CASHIER" ? <option value="">All branches</option> : null}
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        {departmentsOn ? (
          limitable ? (
            <fieldset>
              <legend className="mb-1.5 text-sm font-semibold text-ink-800">Which counter do they work?</legend>
              <div className="grid grid-cols-3 gap-2">
                {[
                  ["", "Both", "Sees all products"],
                  ["SUPERMARKET", "Supermarket", "Groceries only"],
                  ["PHARMACY", "Pharmacy", "Drugs only"],
                ].map(([value, label, hint]) => {
                  const on = department === value;
                  return (
                    <button
                      key={value || "both"}
                      type="button"
                      onClick={() => setDepartment(value)}
                      aria-pressed={on}
                      className={`rounded-xl border-2 px-3 py-2.5 text-left transition ${
                        on
                          ? value === "PHARMACY"
                            ? "border-good-700 bg-good-50"
                            : "border-navy-700 bg-navy-50"
                          : "border-hairline hover:border-ink-300"
                      }`}
                    >
                      <span className="block text-sm font-bold text-ink-950">{label}</span>
                      <span className="block text-xs text-ink-500">{hint}</span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-xs text-ink-500">
                At the till they only see and sell products from this department.
              </p>
            </fieldset>
          ) : (
            <p className="rounded-xl border border-hairline bg-canvas p-3 text-sm text-ink-600">
              {ROLE_LABELS[role]}s see both the supermarket and the pharmacy.
            </p>
          )
        ) : null}

        {/* Access */}
        {role === "MAIN_ADMIN" ? (
          <p className="flex items-start gap-2 rounded-xl border border-navy-100 bg-navy-50 p-3 text-sm text-navy-900">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" />
            A main admin can do everything, including managing staff and seeing profit. Give this
            only to an owner or partner.
          </p>
        ) : (
          <div className="rounded-xl border border-hairline">
            <div className="flex flex-wrap items-center justify-between gap-2 p-3">
              <div>
                <p className="text-sm font-bold text-ink-950">Access</p>
                <p className="text-xs text-ink-500">
                  {customising
                    ? `${permissions.length} thing${permissions.length === 1 ? "" : "s"} selected`
                    : `Standard access for a ${ROLE_LABELS[role].toLowerCase()} (${standardCount} things)`}
                </p>
              </div>
              {canSetAccess ? (
                <button
                  type="button"
                  onClick={() => setCustomising((v) => !v)}
                  className="text-xs font-bold text-navy-700 underline-offset-2 hover:underline"
                >
                  {customising ? "Hide the list" : "Choose exactly what they can do"}
                </button>
              ) : null}
            </div>

            {customising && canSetAccess ? (
              <div className="space-y-4 border-t border-hairline p-3">
                {PERMISSION_GROUPS.map((group) => (
                  <div key={group.key}>
                    <p className="text-xs font-bold uppercase tracking-wider text-ink-500">{group.label}</p>
                    <div className="mt-1.5 grid gap-x-4 gap-y-1 sm:grid-cols-2">
                      {group.permissions.map((perm) => {
                        const checked = permissions.includes(perm.key);
                        const allowed = grantable(perm.key) || checked;
                        return (
                          <label
                            key={perm.key}
                            className={`flex items-start gap-2 py-1 text-sm ${
                              allowed ? "cursor-pointer" : "cursor-not-allowed opacity-50"
                            }`}
                            title={allowed ? undefined : "You don't have this access yourself"}
                          >
                            <input
                              type="checkbox"
                              className="mt-0.5 size-4 shrink-0 accent-navy-700"
                              checked={checked}
                              disabled={!allowed}
                              onChange={() => togglePermission(perm.key)}
                            />
                            <span>
                              <span className="font-medium text-ink-900">{perm.label}</span>
                              {perm.hint ? (
                                <span className="block text-xs text-ink-500">{perm.hint}</span>
                              ) : null}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setPermissions(DEFAULT_ROLE_PERMISSIONS[role]);
                    setTouchedAccess(true);
                  }}
                  className="text-xs font-bold text-ink-600 underline-offset-2 hover:underline"
                >
                  Back to standard access
                </button>
              </div>
            ) : null}
            {fieldErrors.permissions ? (
              <p className="border-t border-hairline p-3 text-xs font-medium text-bad-700">
                Choose at least one thing this person can do.
              </p>
            ) : null}
          </div>
        )}

        {error ? (
          <p role="alert" className="rounded-lg border border-bad-200 bg-bad-50 px-3 py-2 text-sm font-medium text-bad-700">
            {error}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The temporary password, shown once
// ─────────────────────────────────────────────────────────────────────────────

/** 0803… → 234803… for a wa.me link. Returns null if it isn't a usable number. */
function whatsappNumber(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("234") && digits.length === 13) return digits;
  if (digits.startsWith("0") && digits.length === 11) return `234${digits.slice(1)}`;
  if (digits.length === 10) return `234${digits}`;
  return null;
}

function PasswordReveal({ reveal, onClose }: { reveal: Reveal; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  const signInWith = reveal.email ?? reveal.name;
  const message = `Hello ${reveal.name.split(" ")[0]}, here is your Coderswurld Inventory sign-in.\n\n${reveal.email ? "Email" : "Name"}: ${signInWith}\nTemporary password: ${reveal.password}\n\nSign in at ${typeof window !== "undefined" ? window.location.origin : ""}/signin and you will be asked to choose your own password.`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard blocked (http, old browser): the password is on screen to
      // write down instead.
    }
  }

  const number = whatsappNumber(reveal.phone);

  return (
    <Sheet
      title={reveal.isNew ? `${reveal.name} has been added` : `New password for ${reveal.name}`}
      onClose={onClose}
      footer={
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className="btn btn-primary">
            Done
          </button>
        </div>
      }
    >
      <div className="space-y-4 p-4">
        <p className="text-sm leading-relaxed text-ink-700">
          Give them these details. They will be asked to choose their own password the first time
          they sign in.
        </p>

        <dl className="rounded-xl border border-hairline bg-ink-50 p-4">
          <dt className="text-[0.6875rem] font-bold uppercase tracking-wider text-ink-500">
            {reveal.email ? "Sign in with email (or name)" : "Sign in with name"}
          </dt>
          <dd className="break-all text-sm font-semibold text-ink-950">{signInWith}</dd>
          <dt className="mt-3 text-[0.6875rem] font-bold uppercase tracking-wider text-ink-500">
            Temporary password
          </dt>
          <dd className="select-all font-mono text-xl font-bold tracking-wide text-ink-950">
            {reveal.password}
          </dd>
        </dl>

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={copy} className="btn btn-navy">
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? "Copied" : "Copy details"}
          </button>
          {number ? (
            <a
              href={`https://wa.me/${number}?text=${encodeURIComponent(message)}`}
              target="_blank"
              rel="noreferrer"
              className="btn btn-outline"
            >
              <MessageCircle className="size-4" />
              Send on WhatsApp
            </a>
          ) : null}
        </div>

        <p className="rounded-lg border border-warn-200 bg-warn-50 px-3 py-2 text-sm font-medium text-warn-700">
          This password is shown only once. If it gets lost, use Reset password to make a new one.
        </p>
      </div>
    </Sheet>
  );
}
