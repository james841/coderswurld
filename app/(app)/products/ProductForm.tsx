"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Barcode } from "@/components/Barcode";
import { PRODUCT_UNITS } from "@/lib/constants";
import { formatNaira, marginPercent, markupPercent, parseMoneyInput } from "@/lib/money";
import { ProductInputSchema, productBusinessRules } from "@/lib/productInput";

/**
 * The add / edit product form.
 *
 * VALIDATION RUNS THE API'S OWN SCHEMA
 * ------------------------------------
 * `ProductInputSchema` is imported straight from `lib/productInput.ts` and run on
 * the client before anything is sent. That is the whole reason the schema lives
 * outside the route: a form with its own idea of what's valid drifts from the
 * server within a week, and the symptom is a red message under the wrong field
 * after a round trip. Here the form decides nothing the server doesn't.
 *
 * The cross-field checks in `productBusinessRules` run too, so "you entered a
 * cost but no selling price" appears instantly rather than on save.
 *
 * MONEY IS TEXT UNTIL IT ISN'T
 * ----------------------------
 * Prices are held as the string the person typed ("1,250.50", "₦1250") and only
 * become integer kobo inside the schema. Holding them as numbers would fight the
 * person mid-keystroke — typing "1250." into a number field is a losing battle.
 */
export interface ProductFormValues {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  unit: string;
  packSize: string | null;
  description: string | null;
  costPriceKobo: number;
  sellingPriceKobo: number;
  wholesalePriceKobo: number;
  wholesaleMinQty: number;
  minStock: number;
  trackExpiry: boolean;
  expiryDate: string | null;
  imageThumb: string | null;
  categoryId: string | null;
  supplierId: string | null;
  department: string;
}

interface FormState {
  department: "SUPERMARKET" | "PHARMACY";
  name: string;
  sku: string;
  barcode: string;
  categoryId: string;
  supplierId: string;
  unit: string;
  packSize: string;
  description: string;
  costPrice: string;
  sellingPrice: string;
  wholesalePrice: string;
  wholesaleMinQty: string;
  minStock: string;
  openingStock: string;
  trackExpiry: boolean;
  expiryDate: string;
  imageThumb: string;
}

const BLANK: FormState = {
  department: "SUPERMARKET",
  name: "",
  sku: "",
  barcode: "",
  categoryId: "",
  supplierId: "",
  unit: "pcs",
  packSize: "",
  description: "",
  costPrice: "",
  sellingPrice: "",
  wholesalePrice: "",
  wholesaleMinQty: "12",
  minStock: "0",
  openingStock: "",
  trackExpiry: false,
  expiryDate: "",
  imageThumb: "",
};

function seedFrom(product: ProductFormValues): FormState {
  const naira = (kobo: number) => (kobo > 0 ? String(kobo / 100) : "");
  return {
    department: product.department === "PHARMACY" ? "PHARMACY" : "SUPERMARKET",
    name: product.name,
    sku: product.sku ?? "",
    barcode: product.barcode ?? "",
    categoryId: product.categoryId ?? "",
    supplierId: product.supplierId ?? "",
    unit: product.unit,
    packSize: product.packSize ?? "",
    description: product.description ?? "",
    costPrice: naira(product.costPriceKobo),
    sellingPrice: naira(product.sellingPriceKobo),
    wholesalePrice: naira(product.wholesalePriceKobo),
    wholesaleMinQty: String(product.wholesaleMinQty),
    minStock: String(product.minStock),
    openingStock: "",
    trackExpiry: product.trackExpiry,
    expiryDate: product.expiryDate ? product.expiryDate.slice(0, 10) : "",
    imageThumb: product.imageThumb ?? "",
  };
}

export function ProductForm({
  mode,
  product,
  categories: initialCategories,
  suppliers: initialSuppliers,
  canCost,
  departments,
}: {
  mode: "create" | "edit";
  /**
   * Present when the shop runs separate Supermarket and Pharmacy departments.
   * `locked` is set for someone limited to one department: the choice is
   * shown but fixed.
   */
  departments?: { locked: "SUPERMARKET" | "PHARMACY" | null };
  /** Present in edit mode. */
  product?: ProductFormValues;
  categories: { id: string; name: string }[];
  suppliers: { id: string; name: string }[];
  /** Without PRODUCTS_COST_VIEW the cost field is absent, not merely hidden —
   *  so a submit never writes a price the person can't see. */
  canCost: boolean;
}) {
  const router = useRouter();
  const editing = mode === "edit";
  const productId = product?.id;

  const [form, setForm] = useState<FormState>(
    product
      ? seedFrom(product)
      : { ...BLANK, department: departments?.locked ?? BLANK.department },
  );
  const [categories, setCategories] = useState(initialCategories);
  const [suppliers, setSuppliers] = useState(initialSuppliers);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [duplicate, setDuplicate] = useState<{ id: string; name: string } | null>(null);

  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!editing) nameRef.current?.focus();
  }, [editing]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    // Clear the message the moment the field is touched; a stale error under a
    // field the person just fixed is worse than no error.
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  // ── Live money readouts ───────────────────────────────────────────────────
  const costKobo = useMemo(() => kobo(form.costPrice), [form.costPrice]);
  const sellingKobo = useMemo(() => kobo(form.sellingPrice), [form.sellingPrice]);
  const wholesaleKobo = useMemo(() => kobo(form.wholesalePrice), [form.wholesalePrice]);

  const margin = canCost && costKobo > 0 && sellingKobo > 0
    ? marginPercent(costKobo, sellingKobo)
    : null;
  const markup = canCost && costKobo > 0 && sellingKobo > 0
    ? markupPercent(costKobo, sellingKobo)
    : null;
  // Not an error — clearance is real. A quiet note the person can ignore.
  const sellingBelowCost =
    canCost && costKobo > 0 && sellingKobo > 0 && sellingKobo < costKobo;

  // ── Barcode duplicate probe ───────────────────────────────────────────────
  // The server is the authority (it refuses a clash on save), but finding out
  // here means the person isn't mid-save when they learn the code is taken.
  useEffect(() => {
    const code = form.barcode.trim();
    if (code.length < 4) {
      setDuplicate(null);
      return;
    }
    const controller = new AbortController();
    const id = setTimeout(async () => {
      try {
        const res = await fetch(`/api/products/lookup?barcode=${encodeURIComponent(code)}`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as { product: { id: string; name: string } | null };
        setDuplicate(data.product && data.product.id !== productId ? data.product : null);
      } catch {
        /* A failed probe is not worth a message; save still checks. */
      }
    }, 400);
    return () => {
      clearTimeout(id);
      controller.abort();
    };
  }, [form.barcode, productId]);

  // ── Submit ────────────────────────────────────────────────────────────────
  async function save(again: boolean) {
    setProblem(null);

    const payload: Record<string, unknown> = {
      ...(departments ? { department: form.department } : {}),
      name: form.name,
      sku: form.sku,
      barcode: form.barcode,
      categoryId: form.categoryId,
      supplierId: form.supplierId,
      unit: form.unit,
      packSize: form.packSize,
      description: form.description,
      sellingPrice: form.sellingPrice,
      wholesalePrice: form.wholesalePrice,
      wholesaleMinQty: form.wholesaleMinQty,
      minStock: form.minStock,
      trackExpiry: form.trackExpiry,
      expiryDate: form.expiryDate,
      imageThumb: form.imageThumb,
    };
    // Cost is only ever sent by someone allowed to see it, so a blind submit
    // can't quietly zero a price on edit or invent one on create.
    if (canCost) payload.costPrice = form.costPrice;
    // Stock is seeded once, at create. Afterwards it moves through the ledger.
    if (!editing) payload.openingStock = form.openingStock;

    const parsed = ProductInputSchema.safeParse(payload);
    if (!parsed.success) {
      setErrors(zodFields(parsed.error));
      setProblem("Check the highlighted fields.");
      return;
    }

    const rules = productBusinessRules(parsed.data);
    if (Object.keys(rules).length > 0) {
      setErrors(rules);
      setProblem("A couple of things need fixing first.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(
        editing ? `/api/products/${productId}` : "/api/products",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string; fields?: Record<string, string> }
          | null;
        if (body?.fields) setErrors(body.fields);
        setProblem(body?.error ?? "Couldn't save this product.");
        setSaving(false);
        return;
      }

      if (again) {
        setForm(BLANK);
        setErrors({});
        setSaving(false);
        nameRef.current?.focus();
        router.refresh();
        return;
      }

      router.push("/products");
      router.refresh();
    } catch {
      setProblem("Couldn't reach the server. Check your connection and try again.");
      setSaving(false);
    }
  }

  const priceHint =
    wholesaleKobo > 0 && sellingKobo > 0 && wholesaleKobo > sellingKobo;

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save(false);
      }}
      className="pb-24"
    >
      {problem && (
        <div className="card mb-4 border-bad-200 bg-bad-50 px-4 py-3 text-sm text-bad-700">
          {problem}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* ── Left: the details ───────────────────────────────────────────── */}
        <div className="space-y-4 lg:col-span-2">
          <section className="card card-pad">
            <h2 className="section-title mb-3">What it is</h2>

            <div className="space-y-3.5">
              <Field label="Product name" htmlFor="pf-name" error={errors.name}>
                <input
                  ref={nameRef}
                  id="pf-name"
                  className="input"
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="e.g. Golden Penny Semovita 1kg"
                  aria-invalid={Boolean(errors.name)}
                  autoComplete="off"
                />
              </Field>

              <div className="grid gap-3.5 sm:grid-cols-2">
                <Field
                  label="Stock code (SKU)"
                  htmlFor="pf-sku"
                  error={errors.sku}
                  hint={
                    editing
                      ? "Leave it as it is to keep the current code."
                      : "Leave blank and we'll make one."
                  }
                >
                  <input
                    id="pf-sku"
                    className="input"
                    value={form.sku}
                    onChange={(e) => set("sku", e.target.value.toUpperCase())}
                    placeholder="SEMO-1KG"
                    aria-invalid={Boolean(errors.sku)}
                    autoComplete="off"
                  />
                </Field>

                <Field
                  label="Barcode"
                  htmlFor="pf-barcode"
                  error={errors.barcode}
                  hint="Scan it, or type the number under the bars."
                >
                  <input
                    id="pf-barcode"
                    className="input"
                    value={form.barcode}
                    onChange={(e) => set("barcode", e.target.value.trim())}
                    placeholder="6151100012345"
                    aria-invalid={Boolean(errors.barcode)}
                    inputMode="numeric"
                    autoComplete="off"
                  />
                </Field>
              </div>

              {duplicate && (
                <div className="rounded-lg border border-warn-200 bg-warn-50 px-3 py-2 text-sm text-warn-700">
                  <span className="font-semibold">{duplicate.name}</span> already uses
                  this barcode.{" "}
                  <a
                    href={`/products/${duplicate.id}/edit`}
                    className="font-semibold underline"
                  >
                    Open it
                  </a>{" "}
                  if you meant to change that product instead.
                </div>
              )}

              {departments ? (
                <fieldset>
                  <legend className="label">Department</legend>
                  <div className="grid grid-cols-2 gap-2">
                    {(["SUPERMARKET", "PHARMACY"] as const).map((d) => {
                      const on = form.department === d;
                      const disabled = departments.locked !== null && departments.locked !== d;
                      return (
                        <button
                          key={d}
                          type="button"
                          disabled={disabled}
                          onClick={() => setForm((f) => ({ ...f, department: d }))}
                          aria-pressed={on}
                          className={`rounded-xl border-2 px-3 py-2.5 text-left text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                            on
                              ? d === "PHARMACY"
                                ? "border-good-700 bg-good-50 text-good-700"
                                : "border-navy-700 bg-navy-50 text-navy-800"
                              : "border-hairline text-ink-600 hover:border-ink-300"
                          }`}
                        >
                          {d === "PHARMACY" ? "Pharmacy" : "Supermarket"}
                          <span className="block text-xs font-medium opacity-80">
                            {d === "PHARMACY" ? "Drugs and health items" : "Groceries and household"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-1.5 text-xs text-ink-500">
                    Only cashiers assigned to this department will see it at the till.
                  </p>
                </fieldset>
              ) : null}

              <div className="grid gap-3.5 sm:grid-cols-2">
                <Field label="Category" htmlFor="pf-category" error={errors.categoryId}>
                  <QuickSelect
                    id="pf-category"
                    value={form.categoryId}
                    onChange={(v) => set("categoryId", v)}
                    options={categories}
                    placeholder="Uncategorised"
                    allowCreate
                    createLabel="New category"
                    newPrompt="Name the category"
                    endpoint="/api/products/categories"
                    extract={(body) => (body as { category: { id: string; name: string } }).category}
                    onCreated={(c) => setCategories((prev) => [...prev, c])}
                  />
                </Field>

                <Field
                  label="Where it was bought"
                  htmlFor="pf-supplier"
                  error={errors.supplierId}
                  hint="The market, shop or supplier these came from."
                >
                  <QuickSelect
                    id="pf-supplier"
                    value={form.supplierId}
                    onChange={(v) => set("supplierId", v)}
                    options={suppliers}
                    placeholder="Not recorded"
                    allowCreate
                    createLabel="New place"
                    newPrompt="Name the market or supplier"
                    endpoint="/api/products/suppliers"
                    extract={(body) => (body as { supplier: { id: string; name: string } }).supplier}
                    onCreated={(s) => setSuppliers((prev) => [...prev, s])}
                  />
                </Field>
              </div>

              <div className="grid gap-3.5 sm:grid-cols-2">
                <Field label="Sold by" htmlFor="pf-unit" error={errors.unit}>
                  <select
                    id="pf-unit"
                    className="select"
                    value={form.unit}
                    onChange={(e) => set("unit", e.target.value)}
                  >
                    {PRODUCT_UNITS.map((u) => (
                      <option key={u.value} value={u.value}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field
                  label="Pack size"
                  htmlFor="pf-pack"
                  error={errors.packSize}
                  hint="Optional — e.g. “1kg”, “12 per carton”."
                >
                  <input
                    id="pf-pack"
                    className="input"
                    value={form.packSize}
                    onChange={(e) => set("packSize", e.target.value)}
                    placeholder="1kg"
                    autoComplete="off"
                  />
                </Field>
              </div>

              <Field label="Description" htmlFor="pf-desc" error={errors.description}>
                <textarea
                  id="pf-desc"
                  className="textarea"
                  rows={3}
                  value={form.description}
                  onChange={(e) => set("description", e.target.value)}
                  placeholder="Anything worth noting for staff — brand, size, shelf."
                />
              </Field>
            </div>
          </section>

          {/* ── Prices ────────────────────────────────────────────────────── */}
          <section className="card card-pad">
            <h2 className="section-title mb-3">Prices</h2>
            <p className="-mt-1.5 mb-3.5 text-sm text-ink-500">
              All in naira. The selling price is what the till charges; the
              wholesale price applies from the quantity you set.
            </p>

            <div className="grid gap-3.5 sm:grid-cols-2">
              {canCost && (
                <Field label="Cost price" htmlFor="pf-cost" error={errors.costPrice}>
                  <MoneyInput
                    id="pf-cost"
                    value={form.costPrice}
                    onChange={(v) => set("costPrice", v)}
                    placeholder="0"
                    invalid={Boolean(errors.costPrice)}
                  />
                </Field>
              )}

              <Field
                label="Selling price"
                htmlFor="pf-selling"
                error={errors.sellingPrice}
                hint={
                  margin !== null
                    ? `Margin ${margin.toFixed(0)}%${
                        markup !== null ? ` · markup ${markup.toFixed(0)}%` : ""
                      }`
                    : undefined
                }
              >
                <MoneyInput
                  id="pf-selling"
                  value={form.sellingPrice}
                  onChange={(v) => set("sellingPrice", v)}
                  placeholder="0"
                  invalid={Boolean(errors.sellingPrice)}
                />
              </Field>
            </div>

            {sellingBelowCost && (
              <p className="mt-2 text-sm text-warn-700">
                You&apos;re selling this below what it cost. That&apos;s fine for
                clearance — just make sure it&apos;s what you meant.
              </p>
            )}

            <div className="mt-3.5 grid gap-3.5 sm:grid-cols-2">
              <Field
                label="Wholesale price"
                htmlFor="pf-wholesale"
                error={errors.wholesalePrice}
                hint={priceHint ? undefined : "Leave at 0 if you don't sell in bulk."}
              >
                <MoneyInput
                  id="pf-wholesale"
                  value={form.wholesalePrice}
                  onChange={(v) => set("wholesalePrice", v)}
                  placeholder="0"
                  invalid={Boolean(errors.wholesalePrice || priceHint)}
                />
              </Field>

              <Field
                label="Wholesale starts at"
                htmlFor="pf-wholesale-qty"
                error={errors.wholesaleMinQty}
              >
                <div className="flex items-center gap-2">
                  <input
                    id="pf-wholesale-qty"
                    className="input"
                    value={form.wholesaleMinQty}
                    onChange={(e) => set("wholesaleMinQty", e.target.value)}
                    inputMode="numeric"
                    aria-invalid={Boolean(errors.wholesaleMinQty)}
                  />
                  <span className="shrink-0 text-sm text-ink-500">
                    {unitLabel(form.unit)}
                  </span>
                </div>
              </Field>
            </div>
          </section>

          {/* ── Stock ─────────────────────────────────────────────────────── */}
          <section className="card card-pad">
            <h2 className="section-title mb-3">Stock</h2>

            <div className="grid gap-3.5 sm:grid-cols-2">
              <Field
                label="Warn me when it drops to"
                htmlFor="pf-minstock"
                error={errors.minStock}
                hint="0 turns the low-stock warning off for this product."
              >
                <div className="flex items-center gap-2">
                  <input
                    id="pf-minstock"
                    className="input"
                    value={form.minStock}
                    onChange={(e) => set("minStock", e.target.value)}
                    inputMode="decimal"
                    aria-invalid={Boolean(errors.minStock)}
                  />
                  <span className="shrink-0 text-sm text-ink-500">
                    {unitLabel(form.unit)}
                  </span>
                </div>
              </Field>

              {!editing && (
                <Field
                  label="How many do you have now?"
                  htmlFor="pf-opening"
                  error={errors.openingStock}
                  hint="Counted once, today. Later changes go through stock movements."
                >
                  <div className="flex items-center gap-2">
                    <input
                      id="pf-opening"
                      className="input"
                      value={form.openingStock}
                      onChange={(e) => set("openingStock", e.target.value)}
                      placeholder="0"
                      inputMode="decimal"
                      aria-invalid={Boolean(errors.openingStock)}
                    />
                    <span className="shrink-0 text-sm text-ink-500">
                      {unitLabel(form.unit)}
                    </span>
                  </div>
                </Field>
              )}
            </div>

            <label className="mt-3.5 flex cursor-pointer items-start gap-3 rounded-lg border border-ink-200 p-3">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-brand-700"
                checked={form.trackExpiry}
                onChange={(e) => {
                  const on = e.target.checked;
                  set("trackExpiry", on);
                  if (!on) set("expiryDate", "");
                }}
              />
              <span>
                <span className="block text-sm font-semibold text-ink-800">
                  This product expires
                </span>
                <span className="mt-0.5 block text-sm text-ink-500">
                  We&apos;ll warn you before the date, and list it under Expiring
                  soon.
                </span>
              </span>
            </label>

            {form.trackExpiry && (
              <div className="mt-3.5">
                <Field label="Expiry date" htmlFor="pf-expiry" error={errors.expiryDate}>
                  <input
                    id="pf-expiry"
                    type="date"
                    className="input sm:max-w-xs"
                    value={form.expiryDate}
                    onChange={(e) => set("expiryDate", e.target.value)}
                    aria-invalid={Boolean(errors.expiryDate)}
                  />
                </Field>
              </div>
            )}
          </section>
        </div>

        {/* ── Right: what the shelf label will look like ───────────────────── */}
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <section className="card card-pad">
            <h2 className="section-title mb-3">Preview</h2>

            <div className="flex gap-3">
              <ThumbPicker
                value={form.imageThumb}
                onChange={(v) => set("imageThumb", v)}
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink-900">
                  {form.name.trim() || "Product name"}
                </p>
                <p className="tabular mt-0.5 text-lg font-bold text-ink-950">
                  {sellingKobo > 0 ? formatNaira(sellingKobo) : "₦0"}
                </p>
                <p className="truncate text-xs text-ink-400">
                  {form.sku.trim() || "no code yet"}
                </p>
              </div>
            </div>

            <div className="mt-4 border-t border-ink-100 pt-3">
              {form.barcode.trim() ? (
                <div className="flex flex-col items-center">
                  <Barcode
                    value={form.barcode.trim()}
                    moduleWidth={1.6}
                    height={44}
                    fontSize={10}
                  />
                  <p className="mt-1 text-xs text-ink-400">
                    Check the bars print sharp before you rely on it.
                  </p>
                </div>
              ) : (
                <p className="text-sm text-ink-500">
                  Type or scan a barcode and it will show up here.
                </p>
              )}
            </div>
          </section>
        </aside>
      </div>

      {/* ── Action bar ──────────────────────────────────────────────────── */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-hairline bg-surface/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-end gap-2 px-4 py-3">
          {problem && (
            <span className="mr-auto hidden text-sm text-bad-700 sm:block">
              {problem}
            </span>
          )}
          <a href="/products" className="btn btn-ghost">
            Cancel
          </a>
          {!editing && (
            <button
              type="button"
              className="btn btn-outline"
              disabled={saving}
              onClick={() => void save(true)}
            >
              Save &amp; add another
            </button>
          )}
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Saving…" : editing ? "Save changes" : "Save product"}
          </button>
        </div>
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pieces
// ─────────────────────────────────────────────────────────────────────────────

function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <p className="error-text">{error}</p>
      ) : hint ? (
        <p className="hint">{hint}</p>
      ) : null}
    </div>
  );
}

/** A price field that keeps what was typed and reformats it on the way out. */
function MoneyInput({
  id,
  value,
  onChange,
  placeholder,
  invalid,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  invalid?: boolean;
}) {
  return (
    <div className="flex items-center rounded-lg border border-ink-200 bg-surface focus-within:border-brand-700 focus-within:ring-3 focus-within:ring-brand-100">
      <span className="pl-3 text-sm text-ink-400">₦</span>
      <input
        id={id}
        className="w-full rounded-lg border-0 bg-transparent px-2 py-2.5 text-[0.9375rem] text-ink-900 outline-none"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          const parsed = parseMoneyInput(value);
          if (!Number.isNaN(parsed) && parsed > 0) onChange(String(parsed));
        }}
        placeholder={placeholder}
        inputMode="decimal"
        autoComplete="off"
        aria-invalid={invalid || undefined}
      />
    </div>
  );
}

/**
 * A select that can grow a new option in place.
 *
 * Choosing "＋ New category" swaps the select for a one-line input; the POST
 * goes to the find-or-create route, which hands back the existing row if the
 * name is already there — so re-typing "Drinks" quietly selects Drinks rather
 * than failing. The new option is appended locally so the select can show it
 * without a page reload.
 */
function QuickSelect<T extends { id: string; name: string }>({
  id,
  value,
  onChange,
  options,
  placeholder,
  allowCreate,
  createLabel,
  newPrompt,
  endpoint,
  extract,
  onCreated,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: T[];
  placeholder: string;
  allowCreate?: boolean;
  createLabel?: string;
  newPrompt?: string;
  endpoint?: string;
  extract?: (body: unknown) => T;
  onCreated?: (item: T) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    const name = draft.trim();
    if (!endpoint || !extract || name.length < 2) {
      setError("Use at least two letters.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError((body as { error?: string } | null)?.error ?? "Couldn't add that.");
        setBusy(false);
        return;
      }
      const item = extract(body);
      onCreated?.(item);
      onChange(item.id);
      setAdding(false);
      setDraft("");
      setBusy(false);
    } catch {
      setError("Couldn't reach the server.");
      setBusy(false);
    }
  }

  if (adding) {
    return (
      <div>
        <div className="flex gap-2">
          <input
            className="input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={newPrompt}
            autoFocus
            autoComplete="off"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void create();
              }
              if (e.key === "Escape") {
                setAdding(false);
                setError(null);
              }
            }}
          />
          <button
            type="button"
            className="btn btn-primary shrink-0"
            disabled={busy}
            onClick={() => void create()}
          >
            {busy ? "…" : "Add"}
          </button>
          <button
            type="button"
            className="btn btn-ghost shrink-0"
            onClick={() => {
              setAdding(false);
              setError(null);
            }}
          >
            Cancel
          </button>
        </div>
        {error && <p className="error-text">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <select
        id={id}
        className="select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      {allowCreate && (
        <button
          type="button"
          className="btn btn-outline shrink-0"
          onClick={() => setAdding(true)}
          title={createLabel}
        >
          + New
        </button>
      )}
    </div>
  );
}

/**
 * A square thumbnail picker.
 *
 * There is no object storage wired up yet, so this keeps the *smallest useful*
 * image — a 64px square, JPEG, stepped down in quality until it fits a few
 * kilobytes — and stores that inline. It is a shelf cue for the product list,
 * not a product photo, and it is deliberately capped so a shop with 4,000 lines
 * doesn't carry 4,000 full-size images in the database.
 */
function ThumbPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handle(file: File) {
    setBusy(true);
    try {
      onChange(await compress(file));
    } catch {
      onChange("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shrink-0">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handle(file);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="grid size-16 place-items-center overflow-hidden rounded-lg border border-dashed border-ink-300 bg-ink-50 text-ink-400 hover:border-brand-400 hover:text-brand-700"
        title={value ? "Change picture" : "Add a picture"}
      >
        {busy ? (
          <span className="text-xs">…</span>
        ) : value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="" className="size-full object-cover" />
        ) : (
          <span className="text-xs font-semibold">+ Photo</span>
        )}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function kobo(raw: string): number {
  const parsed = parseMoneyInput(raw);
  return Number.isNaN(parsed) ? 0 : Math.round(parsed * 100);
}

function unitLabel(value: string): string {
  return PRODUCT_UNITS.find((u) => u.value === value)?.label.toLowerCase() ?? value;
}

function zodFields(error: {
  issues: { path: PropertyKey[]; message: string }[];
}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/** Cover-fit to 64px, then step JPEG quality down until it fits the column. */
async function compress(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  const scale = Math.max(size / bitmap.width, size / bitmap.height);
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  ctx.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h);
  bitmap.close?.();

  let quality = 0.7;
  let out = canvas.toDataURL("image/jpeg", quality);
  // `imageThumb` is capped at 4000 characters by the schema; 3800 leaves room
  // for the data-URL prefix and the JSON around it.
  while (out.length > 3800 && quality > 0.25) {
    quality -= 0.1;
    out = canvas.toDataURL("image/jpeg", quality);
  }
  return out;
}
