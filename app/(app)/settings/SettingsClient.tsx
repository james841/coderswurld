"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Bell,
  Building2,
  Check,
  CreditCard,
  Loader2,
  MapPin,
  Pencil,
  Percent,
  Plus,
  Receipt,
  ShoppingCart,
} from "lucide-react";

import {
  BUSINESS_TYPES,
  BUSINESS_TYPE_LABELS,
  NIGERIAN_STATES,
  UNLIMITED,
} from "@/lib/constants";
import type { SeatSummary, SeatUsage } from "@/lib/staff";

import { Field, Sheet, Toggle } from "@/components/ui/Sheet";
import { type ReceiptWidth } from "@/lib/receiptDesign";

/**
 * Settings.
 *
 * HOW IT IS ORGANISED
 * -------------------
 * One section on screen at a time, picked from a short menu. Twenty-five
 * switches on a single scrolling page is how settings screens become the place
 * nobody dares touch; seven short pages, each named for the thing it changes,
 * is how an owner finds "what prints at the bottom of my receipt" in two taps.
 *
 * Each section saves on its own and sends only its own fields. An owner fixing
 * the receipt footer never accidentally saves a half-typed VAT rate.
 *
 * Every switch here is one the product already obeys. Nothing decorative.
 */

export interface SettingsValues {
  name: string;
  businessType: string;
  email: string;
  phone: string;
  whatsapp: string | null;
  address: string | null;
  city: string | null;
  state: string | null;

  departmentsEnabled: boolean;

  receiptWidth: ReceiptWidth;
  receiptHeader: string | null;
  receiptFooter: string;
  receiptShowCashier: boolean;
  receiptAutoPrint: boolean;

  allowNegativeStock: boolean;
  autoWholesale: boolean;
  defaultPriceMode: "RETAIL" | "WHOLESALE";
  requireCustomerForCredit: boolean;

  expiryWarningDays: number;

  dailyReportEnabled: boolean;
  reportChannel: "NONE" | "EMAIL" | "WHATSAPP" | "BOTH";
  reportEmail: string | null;
  reportWhatsapp: string | null;
  reportTime: string;
  reportToAllAdmins: boolean;

  vatEnabled: boolean;
  vatPercent: number;
  vatInclusive: boolean;
}

interface BranchRow {
  id: string;
  name: string;
  code: string;
  address: string | null;
  phone: string | null;
  isMain: boolean;
  isActive: boolean;
  staffCount: number;
}

interface ApiFailure {
  error?: string;
  fields?: Record<string, string>;
}

type SectionId = "business" | "branches" | "receipt" | "till" | "alerts" | "tax" | "plan";

const SECTIONS: { id: SectionId; label: string; icon: typeof Building2 }[] = [
  { id: "business", label: "Business details", icon: Building2 },
  { id: "branches", label: "Branches", icon: MapPin },
  { id: "receipt", label: "Receipt", icon: Receipt },
  { id: "till", label: "Till", icon: ShoppingCart },
  { id: "alerts", label: "Alerts and daily report", icon: Bell },
  { id: "tax", label: "VAT", icon: Percent },
  { id: "plan", label: "Your plan", icon: CreditCard },
];

type Key = keyof SettingsValues;

export function SettingsClient({
  initial,
  initialBranches,
  branchSeats,
  seats,
  canManage,
  plan,
  delivery,
}: {
  initial: SettingsValues;
  initialBranches: BranchRow[];
  branchSeats: SeatUsage;
  seats: SeatSummary;
  canManage: boolean;
  plan: { name: string; expiresOn: string | null };
  delivery: { email: boolean; whatsapp: boolean };
}) {
  const [section, setSection] = useState<SectionId>("business");
  const [values, setValues] = useState<SettingsValues>(initial);
  /** What the server last confirmed. "Unsaved" means different from this. */
  const [saved, setSaved] = useState<SettingsValues>(initial);
  const [savingSection, setSavingSection] = useState<SectionId | null>(null);
  const [justSaved, setJustSaved] = useState<SectionId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function set<K extends Key>(key: K, value: SettingsValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setJustSaved(null);
  }

  function isDirty(keys: Key[]): boolean {
    return keys.some((key) => values[key] !== saved[key]);
  }

  async function save(id: SectionId, keys: Key[]) {
    setSavingSection(id);
    setError(null);
    setFieldErrors({});
    try {
      const body: Record<string, unknown> = {};
      for (const key of keys) body[key] = values[key];
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setSaved((current) => {
          const next = { ...current };
          for (const key of keys) (next[key] as SettingsValues[Key]) = values[key];
          return next;
        });
        setJustSaved(id);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as ApiFailure;
      setError(data.error ?? "Couldn't save. Please try again.");
      if (data.fields) setFieldErrors(data.fields);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setSavingSection(null);
    }
  }

  function pick(id: SectionId) {
    setSection(id);
    setError(null);
    setFieldErrors({});
    setJustSaved(null);
  }

  /** Save bar shared by every section. */
  function footer(id: SectionId, keys: Key[]) {
    if (!canManage) return null;
    const dirty = isDirty(keys);
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline p-4">
        <p className="text-sm" aria-live="polite">
          {error && section === id ? (
            <span role="alert" className="font-medium text-bad-700">
              {error}
            </span>
          ) : justSaved === id ? (
            <span className="inline-flex items-center gap-1.5 font-semibold text-good-700">
              <Check className="size-4" />
              Saved
            </span>
          ) : dirty ? (
            <span className="text-ink-500">You have changes that are not saved yet.</span>
          ) : null}
        </p>
        <button
          type="button"
          onClick={() => void save(id, keys)}
          disabled={!dirty || savingSection !== null}
          className="btn btn-primary"
        >
          {savingSection === id ? <Loader2 className="size-4 animate-spin" /> : null}
          Save changes
        </button>
      </div>
    );
  }

  const ro = !canManage;

  return (
    <div className="gap-6 lg:grid lg:grid-cols-[14rem_minmax(0,1fr)]">
      {/* Section menu: a column on a desktop, a swipeable row on a phone. */}
      <nav
        aria-label="Settings sections"
        className="mb-4 flex gap-1.5 overflow-x-auto pb-1 lg:mb-0 lg:flex-col lg:overflow-visible"
      >
        {SECTIONS.map((s) => {
          const active = s.id === section;
          const Icon = s.icon;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => pick(s.id)}
              aria-current={active ? "page" : undefined}
              className={`flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm font-semibold transition-colors ${
                active
                  ? "bg-navy-700 text-white"
                  : "bg-surface text-ink-600 hover:bg-navy-50 hover:text-navy-800 lg:bg-transparent"
              }`}
            >
              <Icon className="size-4 shrink-0" />
              {s.label}
            </button>
          );
        })}
      </nav>

      <div className="min-w-0">
        {ro ? (
          <p className="mb-3 rounded-lg border border-hairline bg-surface px-3 py-2 text-sm text-ink-600">
            You can look at these settings, but only someone with permission to change settings can
            edit them.
          </p>
        ) : null}

        {/* ── Business ─────────────────────────────────────────────────────── */}
        {section === "business" ? (
          <SectionCard
            title="Business details"
            description="Shown on receipts and reports, and how Coderswurld reaches you."
            footer={footer("business", ["name", "businessType", "email", "phone", "whatsapp", "address", "city", "state", "departmentsEnabled"])}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Business name" error={fieldErrors.name} className="sm:col-span-2">
                <input
                  value={values.name}
                  onChange={(e) => set("name", e.target.value)}
                  className="input"
                  disabled={ro}
                  maxLength={120}
                />
              </Field>
              <Field label="Type of business" error={fieldErrors.businessType}>
                <select
                  value={values.businessType}
                  onChange={(e) => set("businessType", e.target.value)}
                  className="select"
                  disabled={ro}
                >
                  {BUSINESS_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {BUSINESS_TYPE_LABELS[type]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Phone" error={fieldErrors.phone}>
                <input
                  type="tel"
                  value={values.phone}
                  onChange={(e) => set("phone", e.target.value)}
                  className="input"
                  disabled={ro}
                  maxLength={30}
                />
              </Field>
              <Field label="Email" error={fieldErrors.email}>
                <input
                  type="email"
                  value={values.email}
                  onChange={(e) => set("email", e.target.value)}
                  className="input"
                  disabled={ro}
                  maxLength={160}
                />
              </Field>
              <Field label="WhatsApp number" hint="Optional" error={fieldErrors.whatsapp}>
                <input
                  type="tel"
                  value={values.whatsapp ?? ""}
                  onChange={(e) => set("whatsapp", e.target.value || null)}
                  className="input"
                  disabled={ro}
                  maxLength={30}
                />
              </Field>
              <Field label="Address" error={fieldErrors.address} className="sm:col-span-2">
                <input
                  value={values.address ?? ""}
                  onChange={(e) => set("address", e.target.value || null)}
                  className="input"
                  disabled={ro}
                  maxLength={240}
                />
              </Field>
              <Field label="City or town" error={fieldErrors.city}>
                <input
                  value={values.city ?? ""}
                  onChange={(e) => set("city", e.target.value || null)}
                  className="input"
                  disabled={ro}
                  maxLength={80}
                />
              </Field>
              <Field label="State" error={fieldErrors.state}>
                <select
                  value={values.state ?? ""}
                  onChange={(e) => set("state", e.target.value || null)}
                  className="select"
                  disabled={ro}
                >
                  <option value="">Choose a state</option>
                  {NIGERIAN_STATES.map((state) => (
                    <option key={state} value={state}>
                      {state}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="mt-5 rounded-2xl border border-hairline bg-canvas px-4">
              <Toggle
                checked={values.departmentsEnabled}
                onChange={(v) => set("departmentsEnabled", v)}
                label="This shop has a supermarket and a pharmacy"
                description="Mark each product as Supermarket or Pharmacy, and assign each cashier or storekeeper to one. They will only see and sell their own department's products. Admins and managers always see both."
                disabled={ro}
              />
            </div>
          </SectionCard>
        ) : null}

        {/* ── Branches ─────────────────────────────────────────────────────── */}
        {section === "branches" ? (
          <BranchesSection initial={initialBranches} seat={branchSeats} canManage={canManage} />
        ) : null}

        {/* ── Receipt ──────────────────────────────────────────────────────── */}
        {section === "receipt" ? (
          <SectionCard
            title="Receipt"
            description="Style, logo, phone numbers and what prints on every receipt now live on their own page, with a live preview. Managers can open it too."
          >
            <Link href="/receipt-design" className="btn btn-primary">
              Open receipt design
            </Link>
          </SectionCard>
        ) : null}

        {/* ── Till ─────────────────────────────────────────────────────────── */}
        {section === "till" ? (
          <SectionCard
            title="Till"
            description="How selling works. A till picks up changes the next time it is opened or refreshed with internet."
            footer={footer("till", ["defaultPriceMode", "autoWholesale", "requireCustomerForCredit", "allowNegativeStock"])}
          >
            <Field label="A new sale starts as" className="max-w-xs">
              <select
                value={values.defaultPriceMode}
                onChange={(e) => set("defaultPriceMode", e.target.value as "RETAIL" | "WHOLESALE")}
                className="select"
                disabled={ro}
              >
                <option value="RETAIL">Retail prices</option>
                <option value="WHOLESALE">Wholesale prices</option>
              </select>
            </Field>
            <div className="mt-2 divide-y divide-hairline">
              <Toggle
                checked={values.autoWholesale}
                onChange={(v) => set("autoWholesale", v)}
                label="Give the wholesale price automatically"
                description="When a customer buys enough of one item to reach its wholesale quantity, the till switches that item to the wholesale price."
                disabled={ro}
              />
              <Toggle
                checked={values.requireCustomerForCredit}
                onChange={(v) => set("requireCustomerForCredit", v)}
                label="A credit sale must have a customer"
                description="So every debt has a name and a phone number on it."
                disabled={ro}
              />
              <Toggle
                checked={values.allowNegativeStock}
                onChange={(v) => set("allowNegativeStock", v)}
                label="Allow selling an item that shows zero stock"
                description="Best left off. Turn on only if your stock count is behind and the shelf has goods the system doesn't know about. Your stock figures can go below zero while this is on."
                disabled={ro}
              />
            </div>
          </SectionCard>
        ) : null}

        {/* ── Alerts and daily report ──────────────────────────────────────── */}
        {section === "alerts" ? (
          <SectionCard
            title="Alerts and daily report"
            description="What the system tells you without being asked."
            footer={footer("alerts", [
              "expiryWarningDays",
              "dailyReportEnabled",
              "reportChannel",
              "reportEmail",
              "reportWhatsapp",
              "reportTime",
              "reportToAllAdmins",
            ])}
          >
            <Field
              label="Warn me before a product expires"
              hint="Days before the expiry date"
              error={fieldErrors.expiryWarningDays}
              className="max-w-xs"
            >
              <input
                type="number"
                min={1}
                max={730}
                value={Number.isFinite(values.expiryWarningDays) ? values.expiryWarningDays : ""}
                onChange={(e) => set("expiryWarningDays", e.target.valueAsNumber)}
                className="input tabular"
                disabled={ro}
              />
            </Field>

            <div className="mt-4 border-t border-hairline pt-1">
              <Toggle
                checked={values.dailyReportEnabled}
                onChange={(v) => set("dailyReportEnabled", v)}
                label="Send me a daily summary"
                description="Off until you switch it on. At closing time: takings, profit, cash vs transfer vs POS, each cashier, best sellers, what is running low and what is about to expire."
                disabled={ro}
              />
            </div>

            {values.dailyReportEnabled ? (
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <Field label="Send it by" error={fieldErrors.reportChannel}>
                  <select
                    value={values.reportChannel}
                    onChange={(e) => set("reportChannel", e.target.value as SettingsValues["reportChannel"])}
                    className="select"
                    disabled={ro}
                  >
                    <option value="EMAIL">Email</option>
                    <option value="WHATSAPP">WhatsApp</option>
                    <option value="BOTH">Email and WhatsApp</option>
                    <option value="NONE">Don&apos;t send, I&apos;ll read it in Reports</option>
                  </select>
                </Field>
                <Field label="Time" hint="When your day closes" error={fieldErrors.reportTime}>
                  <input
                    type="time"
                    value={values.reportTime}
                    onChange={(e) => set("reportTime", e.target.value)}
                    className="input tabular"
                    disabled={ro}
                  />
                </Field>
                {values.reportChannel === "EMAIL" || values.reportChannel === "BOTH" ? (
                  <Field
                    label="Email for the report"
                    hint="Leave empty to use the business email"
                    error={fieldErrors.reportEmail}
                  >
                    <input
                      type="email"
                      value={values.reportEmail ?? ""}
                      onChange={(e) => set("reportEmail", e.target.value || null)}
                      className="input"
                      placeholder={values.email}
                      disabled={ro}
                      maxLength={160}
                    />
                  </Field>
                ) : null}
                {values.reportChannel === "WHATSAPP" || values.reportChannel === "BOTH" ? (
                  <Field
                    label="WhatsApp number for the report"
                    hint="Leave empty to use the business number"
                    error={fieldErrors.reportWhatsapp}
                  >
                    <input
                      type="tel"
                      value={values.reportWhatsapp ?? ""}
                      onChange={(e) => set("reportWhatsapp", e.target.value || null)}
                      className="input"
                      placeholder={values.whatsapp ?? "0803 000 0000"}
                      disabled={ro}
                      maxLength={30}
                    />
                  </Field>
                ) : null}
                <div className="sm:col-span-2">
                  <Toggle
                    checked={values.reportToAllAdmins}
                    onChange={(v) => set("reportToAllAdmins", v)}
                    label="Also send a copy to every main admin"
                    disabled={ro}
                  />
                </div>

                {(values.reportChannel === "WHATSAPP" || values.reportChannel === "BOTH") && !delivery.whatsapp ? (
                  <p className="rounded-lg border border-warn-200 bg-warn-50 px-3 py-2 text-sm font-medium text-warn-700 sm:col-span-2">
                    WhatsApp sending has not been switched on for this system yet, so the report
                    will not arrive on WhatsApp until it is.
                  </p>
                ) : null}
                {(values.reportChannel === "EMAIL" || values.reportChannel === "BOTH") && !delivery.email ? (
                  <p className="rounded-lg border border-warn-200 bg-warn-50 px-3 py-2 text-sm font-medium text-warn-700 sm:col-span-2">
                    Email sending has not been switched on for this system yet, so the report will
                    not arrive by email until it is.
                  </p>
                ) : null}
              </div>
            ) : null}
          </SectionCard>
        ) : null}

        {/* ── VAT ──────────────────────────────────────────────────────────── */}
        {section === "tax" ? (
          <SectionCard
            title="VAT"
            description="Most small shops leave this off. Turn it on only if you are registered for VAT and need it on your receipts."
            footer={footer("tax", ["vatEnabled", "vatPercent", "vatInclusive"])}
          >
            <Toggle
              checked={values.vatEnabled}
              onChange={(v) => set("vatEnabled", v)}
              label="Show VAT on sales"
              disabled={ro}
            />
            {values.vatEnabled ? (
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <Field label="VAT rate" hint="Percent" error={fieldErrors.vatPercent}>
                  <input
                    type="number"
                    min={0}
                    max={50}
                    step={0.5}
                    value={Number.isFinite(values.vatPercent) ? values.vatPercent : ""}
                    onChange={(e) => set("vatPercent", e.target.valueAsNumber)}
                    className="input tabular"
                    disabled={ro}
                  />
                </Field>
                <Field label="Your shelf prices">
                  <select
                    value={values.vatInclusive ? "IN" : "EX"}
                    onChange={(e) => set("vatInclusive", e.target.value === "IN")}
                    className="select"
                    disabled={ro}
                  >
                    <option value="IN">Already include VAT</option>
                    <option value="EX">Do not include VAT (add it at the till)</option>
                  </select>
                </Field>
              </div>
            ) : null}
          </SectionCard>
        ) : null}

        {/* ── Plan ─────────────────────────────────────────────────────────── */}
        {section === "plan" ? (
          <SectionCard title="Your plan" description="What your subscription covers.">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <p className="text-2xl font-bold text-ink-950">{plan.name}</p>
              {plan.expiresOn ? (
                <p className="text-sm text-ink-600">
                  Paid until <span className="font-semibold text-ink-900">{plan.expiresOn}</span>
                </p>
              ) : null}
            </div>
            <dl className="mt-4 divide-y divide-hairline border-y border-hairline">
              {(
                [
                  ["Main admins", seats.mainAdmin],
                  ["Admins and managers", seats.subAdmin],
                  ["Cashiers", seats.cashier],
                  ["Branches", seats.branches],
                ] as [string, SeatUsage][]
              ).map(([label, seat]) => (
                <div key={label} className="flex items-center justify-between py-2.5 text-sm">
                  <dt className="text-ink-700">{label}</dt>
                  <dd className="tabular font-semibold text-ink-950">
                    {seat.used} in use
                    <span className="font-normal text-ink-500">
                      {seat.limit === UNLIMITED ? " · no limit" : ` of ${seat.limit}`}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-sm leading-relaxed text-ink-600">
              To renew, add more staff or branches, or move to a bigger plan, contact Coderswurld.
            </p>
          </SectionCard>
        ) : null}
      </div>
    </div>
  );
}

function SectionCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <section className="card">
      <div className="border-b border-hairline p-4">
        <h2 className="text-base font-bold text-ink-950">{title}</h2>
        <p className="mt-0.5 text-sm leading-relaxed text-ink-500">{description}</p>
      </div>
      <div className="p-4">{children}</div>
      {footer}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Branches
// ─────────────────────────────────────────────────────────────────────────────

function BranchesSection({
  initial,
  seat,
  canManage,
}: {
  initial: BranchRow[];
  seat: SeatUsage;
  canManage: boolean;
}) {
  const [branches, setBranches] = useState<BranchRow[]>(initial);
  const [editing, setEditing] = useState<BranchRow | "new" | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  const open = branches.filter((b) => b.isActive).length;
  const full = seat.limit !== UNLIMITED && open >= seat.limit;

  function upsert(row: BranchRow) {
    setBranches((current) =>
      current.some((b) => b.id === row.id)
        ? current.map((b) => (b.id === row.id ? row : b))
        : [...current, row],
    );
  }

  async function setActive(branch: BranchRow, isActive: boolean) {
    setBusyId(branch.id);
    setRowError(null);
    try {
      const res = await fetch(`/api/branches/${branch.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      const data = (await res.json().catch(() => ({}))) as ApiFailure & { branch?: BranchRow };
      if (res.ok && data.branch) upsert(data.branch);
      else setRowError({ id: branch.id, message: data.error ?? "Couldn't save. Please try again." });
    } catch {
      setRowError({ id: branch.id, message: "Couldn't reach the server. Check your connection." });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-hairline p-4">
        <div>
          <h2 className="text-base font-bold text-ink-950">Branches</h2>
          <p className="mt-0.5 text-sm leading-relaxed text-ink-500">
            Each branch keeps its own stock and its own receipt numbers.{" "}
            {seat.limit === UNLIMITED
              ? `${open} open.`
              : `${open} of ${seat.limit} on your plan in use.`}
          </p>
        </div>
        {canManage ? (
          <button
            type="button"
            onClick={() => setEditing("new")}
            disabled={full}
            className="btn btn-primary"
            title={full ? "Your plan has no branches left" : undefined}
          >
            <Plus className="size-4" />
            Add branch
          </button>
        ) : null}
      </div>

      <ul className="divide-y divide-hairline">
        {branches.map((branch) => {
          const busy = busyId === branch.id;
          return (
            <li key={branch.id} className={`p-4 ${branch.isActive ? "" : "bg-ink-50"}`}>
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1 basis-56">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-bold text-ink-950">
                    {branch.name}
                    <span className="badge badge-neutral font-mono">{branch.code}</span>
                    {branch.isMain ? <span className="badge badge-navy">Main</span> : null}
                    {!branch.isActive ? <span className="badge badge-neutral">Closed</span> : null}
                  </p>
                  <p className="mt-0.5 text-sm text-ink-500">
                    {branch.address || "No address yet"} · {branch.staffCount} staff
                  </p>
                </div>
                {canManage ? (
                  <div className="flex flex-wrap gap-1.5">
                    {branch.isActive ? (
                      <button
                        type="button"
                        onClick={() => setEditing(branch)}
                        disabled={busy}
                        className="btn btn-outline btn-sm"
                      >
                        <Pencil className="size-4" />
                        Edit
                      </button>
                    ) : null}
                    {!branch.isMain ? (
                      <button
                        type="button"
                        onClick={() => void setActive(branch, !branch.isActive)}
                        disabled={busy}
                        className={`btn btn-sm ${branch.isActive ? "btn-ghost text-bad-700" : "btn-outline"}`}
                      >
                        {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                        {branch.isActive ? "Close branch" : "Reopen"}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {rowError?.id === branch.id ? (
                <p role="alert" className="mt-2 text-sm font-medium text-bad-700">
                  {rowError.message}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>

      {full && canManage ? (
        <p className="border-t border-hairline p-4 text-sm text-ink-600">
          Your plan&apos;s branches are all in use. Contact Coderswurld to add more.
        </p>
      ) : null}

      {editing ? (
        <BranchSheet
          key={editing === "new" ? "new" : editing.id}
          branch={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(row) => {
            upsert(row);
            setEditing(null);
          }}
        />
      ) : null}
    </section>
  );
}

function BranchSheet({
  branch,
  onClose,
  onSaved,
}: {
  branch: BranchRow | null;
  onClose: () => void;
  onSaved: (row: BranchRow) => void;
}) {
  const isEdit = branch !== null;
  const [name, setName] = useState(branch?.name ?? "");
  const [code, setCode] = useState("");
  const [address, setAddress] = useState(branch?.address ?? "");
  const [phone, setPhone] = useState(branch?.phone ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function submit() {
    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      const res = await fetch(isEdit ? `/api/branches/${branch.id}` : "/api/branches", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          isEdit
            ? { name: name.trim(), address: address.trim() || null, phone: phone.trim() || null }
            : { name: name.trim(), code: code.trim(), address: address.trim(), phone: phone.trim() },
        ),
      });
      const data = (await res.json().catch(() => ({}))) as ApiFailure & { branch?: BranchRow };
      if (res.ok && data.branch) {
        onSaved(data.branch);
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

  return (
    <Sheet
      title={isEdit ? `Edit ${branch.name}` : "Add a branch"}
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-ghost" disabled={saving}>
            Cancel
          </button>
          <button type="button" onClick={submit} className="btn btn-primary" disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            {isEdit ? "Save changes" : "Add branch"}
          </button>
        </div>
      }
    >
      <div className="grid gap-3 p-4 sm:grid-cols-2">
        <Field label="Branch name" error={fieldErrors.name} className={isEdit ? "sm:col-span-2" : ""}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input"
            placeholder="e.g. Surulere"
            autoFocus
            maxLength={80}
          />
        </Field>
        {isEdit ? null : (
          <Field label="Short code" hint="Optional, 2 to 4 letters" error={fieldErrors.code}>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4))}
              className="input font-mono"
              placeholder="e.g. SRL"
            />
          </Field>
        )}
        <Field label="Address" hint="Optional" error={fieldErrors.address} className="sm:col-span-2">
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="input"
            maxLength={240}
          />
        </Field>
        <Field label="Phone" hint="Optional" error={fieldErrors.phone}>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="input"
            maxLength={30}
          />
        </Field>
        {isEdit ? (
          <p className="text-xs leading-relaxed text-ink-500 sm:col-span-2">
            The code <span className="font-mono font-bold">{branch.code}</span> can&apos;t be changed.
            It is printed at the start of every receipt number from this branch.
          </p>
        ) : (
          <p className="text-xs leading-relaxed text-ink-500 sm:col-span-2">
            The code goes at the start of this branch&apos;s receipt numbers, like SRL-000001. It
            can&apos;t be changed later. Leave it empty and one is made from the name.
          </p>
        )}
        {error ? (
          <p role="alert" className="rounded-lg border border-bad-200 bg-bad-50 px-3 py-2 text-sm font-medium text-bad-700 sm:col-span-2">
            {error}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
