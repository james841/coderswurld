"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ImagePlus, Loader2, Phone, Plus, RotateCcw, Trash2 } from "lucide-react";

import { ReceiptSheet, type ReceiptSheetData } from "@/components/receipt/ReceiptSheet";
import { Field, Toggle } from "@/components/ui/Sheet";
import {
  DEFAULT_RECEIPT_DESIGN,
  RECEIPT_STYLES,
  RECEIPT_STYLE_INFO,
  type ReceiptDesign,
  type ReceiptStyle,
} from "@/lib/receiptDesign";

interface Values {
  receiptWidth: "80mm" | "58mm";
  receiptHeader: string | null;
  receiptFooter: string;
  receiptShowCashier: boolean;
  receiptShowLogo: boolean;
  receiptAutoPrint: boolean;
  design: ReceiptDesign;
}

/** A believable sale to preview against: a few lines, a discount, change given. */
function sample(cashier: string, vat: boolean): ReceiptSheetData {
  const items = [
    { name: "Golden Penny Sugar 1kg", unit: "pcs", quantity: 2, unitPriceKobo: 190000, lineTotalKobo: 380000 },
    { name: "Indomie Chicken 70g (carton)", unit: "carton", quantity: 1, unitPriceKobo: 1200000, lineTotalKobo: 1200000 },
    { name: "Paracetamol 500mg x10", unit: "pcs", quantity: 3, unitPriceKobo: 60000, lineTotalKobo: 180000 },
  ];
  const subtotal = items.reduce((t, i) => t + i.lineTotalKobo, 0);
  const discount = 50000;
  const tax = vat ? Math.round(((subtotal - discount) * 750) / 10000) : 0;
  const total = subtotal - discount + tax;
  const tendered = Math.ceil(total / 500000) * 500000;
  return {
    receiptNo: "IKJ-000128",
    cashierName: cashier,
    items,
    subtotalKobo: subtotal,
    discountKobo: discount,
    taxKobo: tax,
    totalKobo: total,
    paidKobo: total,
    balanceKobo: 0,
    tenderedKobo: tendered,
    changeKobo: tendered - total,
    paymentMethod: "CASH",
    offline: false,
  };
}

/** Shrink a picture to a small logo that fits a receipt and stores cheaply. */
async function toLogo(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 360 / bitmap.width, 140 / bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  let url = canvas.toDataURL("image/png");
  if (url.length > 110_000) url = canvas.toDataURL("image/webp", 0.85);
  if (url.length > 110_000) url = canvas.toDataURL("image/jpeg", 0.8);
  if (url.length > 110_000) throw new Error("That picture is too detailed for a receipt logo. Try a simpler one.");
  return url;
}

export function ReceiptDesigner({
  org,
  branchName,
  cashierName,
  initial,
  vatEnabled,
  stamp,
}: {
  /** Today's date and time, formatted once on the server so the preview matches. */
  stamp: string;
  org: { name: string; phone: string | null; whatsapp: string | null; address: string | null; logoUrl: string | null; timezone: string };
  branchName: string;
  cashierName: string;
  initial: Values;
  vatEnabled: boolean;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Values>(initial);
  const [saved, setSaved] = useState<Values>(initial);
  const [logo, setLogo] = useState<string | null>(org.logoUrl);
  const [logoChanged, setLogoChanged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const d = values.design;
  const dirty = logoChanged || JSON.stringify(values) !== JSON.stringify(saved);

  const set = <K extends keyof Values>(k: K, v: Values[K]) => {
    setValues((s) => ({ ...s, [k]: v }));
    setMessage(null);
  };
  const setD = <K extends keyof ReceiptDesign>(k: K, v: ReceiptDesign[K]) => {
    setValues((s) => ({ ...s, design: { ...s.design, [k]: v } }));
    setMessage(null);
  };

  const data = useMemo(() => sample(cashierName, vatEnabled), [cashierName, vatEnabled]);

  async function pickLogo(file: File | undefined) {
    if (!file) return;
    try {
      const url = await toLogo(file);
      setLogo(url);
      setLogoChanged(true);
      set("receiptShowLogo", true);
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "Could not use that picture." });
    }
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/receipt-design", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...values, design: { ...d, phones: d.phones.filter((p) => p.trim()) }, ...(logoChanged ? { logo } : {}) }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; fields?: Record<string, string> };
      if (!res.ok) throw new Error(body.fields ? Object.values(body.fields)[0] : body.error || "Could not save. Try again.");
      setSaved(values);
      setLogoChanged(false);
      setMessage({ ok: true, text: "Saved. Every till uses this from its next sale." });
      router.refresh();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "Could not save." });
    } finally {
      setSaving(false);
    }
  }

  const phones = d.phones;
  const businessPhones = [org.phone, org.whatsapp].filter((p): p is string => Boolean(p));

  return (
    <div className="grid gap-6 pb-24 lg:grid-cols-[minmax(0,1fr)_400px]">
      {/* ── Controls ───────────────────────────────────────────────────── */}
      <div className="space-y-4">
        <Card title="Style" note="The overall look.">
          <div className="grid gap-3 sm:grid-cols-3">
            {RECEIPT_STYLES.map((s) => (
              <StyleTile key={s} style={s} active={d.style === s} onPick={() => {
                setD("style", s);
                // Each style has a natural lettering; pick it, the owner can still change it.
                setD("font", s === "CLASSIC" ? "MONO" : "SANS");
              }} />
            ))}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Segmented
              label="Lettering"
              value={d.font}
              options={[["SANS", "Clean"], ["MONO", "Typewriter"]]}
              onChange={(v) => setD("font", v as ReceiptDesign["font"])}
            />
            <Segmented
              label="Text size"
              value={d.textSize}
              options={[["SMALL", "Small"], ["NORMAL", "Normal"], ["LARGE", "Large"]]}
              onChange={(v) => setD("textSize", v as ReceiptDesign["textSize"])}
            />
            <Segmented
              label="Shop name"
              value={d.headerAlign}
              options={[["CENTER", "Centred"], ["LEFT", "Left"]]}
              onChange={(v) => setD("headerAlign", v as ReceiptDesign["headerAlign"])}
            />
          </div>
        </Card>

        <Card title="Top of the receipt" note="Who you are and how to reach you.">
          <div className="flex flex-wrap items-center gap-4">
            <div className="grid size-20 place-items-center overflow-hidden rounded-2xl border border-dashed border-ink-300 bg-canvas">
              {logo ? (
                // eslint-disable-next-line @next/next/no-img-element -- a data-URL preview
                <img src={logo} alt="Your logo" className="max-h-16 max-w-16 object-contain" />
              ) : (
                <ImagePlus className="size-6 text-ink-400" />
              )}
            </div>
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-outline btn-sm" onClick={() => fileRef.current?.click()}>
                  <ImagePlus className="size-4" />
                  {logo ? "Change logo" : "Upload logo"}
                </button>
                {logo ? (
                  <button
                    type="button"
                    className="btn btn-sm text-sell-700 hover:bg-sell-50"
                    onClick={() => {
                      setLogo(null);
                      setLogoChanged(true);
                      set("receiptShowLogo", false);
                    }}
                  >
                    <Trash2 className="size-4" />
                    Remove
                  </button>
                ) : null}
              </div>
              <p className="text-xs text-ink-500">PNG or JPG. It prints in black and white.</p>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => pickLogo(e.target.files?.[0])} />
            </div>
            {logo ? (
              <div className="min-w-48 flex-1">
                <Toggle checked={values.receiptShowLogo} onChange={(v) => set("receiptShowLogo", v)} label="Print the logo" />
              </div>
            ) : null}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label="Line under your shop name" hint="Optional">
              <input
                className="input"
                maxLength={200}
                placeholder="e.g. Fresh every day"
                value={values.receiptHeader ?? ""}
                onChange={(e) => set("receiptHeader", e.target.value || null)}
              />
            </Field>
            <Field label="Tax or registration number" hint="Optional">
              <input
                className="input"
                maxLength={40}
                placeholder="e.g. TIN 12345678-0001"
                value={d.taxId}
                onChange={(e) => setD("taxId", e.target.value)}
              />
            </Field>
          </div>

          {/* Phone numbers */}
          <div className="mt-4 rounded-2xl border border-hairline p-3">
            <Toggle
              checked={d.showPhone}
              onChange={(v) => setD("showPhone", v)}
              label="Print phone numbers"
              description={
                phones.length === 0
                  ? `Prints your business number${org.phone ? ` (${org.phone})` : ""} until you add numbers below.`
                  : "These numbers print on every receipt."
              }
            />
            {d.showPhone ? (
              <div className="space-y-2 pb-1">
                {phones.map((p, i) => (
                  <div key={i} className="flex gap-2">
                    <div className="relative flex-1">
                      <Phone className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
                      <input
                        className="input pl-9"
                        type="tel"
                        inputMode="tel"
                        maxLength={30}
                        placeholder="0803 123 4567"
                        value={p}
                        aria-label={`Phone number ${i + 1}`}
                        onChange={(e) => setD("phones", phones.map((x, j) => (j === i ? e.target.value : x)))}
                      />
                    </div>
                    <button
                      type="button"
                      className="btn btn-icon text-ink-500 hover:bg-sell-50 hover:text-sell-700"
                      aria-label={`Remove phone number ${i + 1}`}
                      onClick={() => setD("phones", phones.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                ))}
                <div className="flex flex-wrap gap-2">
                  {phones.length < 4 ? (
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => setD("phones", [...phones, ""])}>
                      <Plus className="size-4" />
                      Add a phone number
                    </button>
                  ) : (
                    <p className="text-xs text-ink-500">Up to four numbers fit on a receipt.</p>
                  )}
                  {phones.length === 0 && businessPhones.length > 0 ? (
                    <button type="button" className="btn btn-sm text-navy-700 hover:bg-navy-50" onClick={() => setD("phones", [...new Set(businessPhones)])}>
                      Start with my business numbers
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          <div className="mt-2 divide-y divide-hairline">
            <Toggle checked={d.showAddress} onChange={(v) => setD("showAddress", v)} label="Print the address" description={org.address ?? "Add your address in Settings, Business details."} />
            <Toggle checked={d.showBranch} onChange={(v) => setD("showBranch", v)} label="Print the branch name" />
            <Toggle checked={values.receiptShowCashier} onChange={(v) => set("receiptShowCashier", v)} label="Print who served the customer" />
          </div>
        </Card>

        <Card title="Items and money" note="What the customer checks before leaving.">
          <div className="divide-y divide-hairline">
            <Toggle checked={d.showUnitPrice} onChange={(v) => setD("showUnitPrice", v)} label="Show the price of one item" description="e.g. 2 pcs x ₦1,900 under each line." />
            <Toggle checked={d.showItemCount} onChange={(v) => setD("showItemCount", v)} label="Show how many items were bought" />
            <Toggle checked={d.showSavings} onChange={(v) => setD("showSavings", v)} label={`Show "You saved ₦..." when there is a discount`} />
          </div>
        </Card>

        <Card title="Bottom of the receipt">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Message at the bottom">
              <input
                className="input"
                maxLength={200}
                placeholder="e.g. Thank you! No refund after payment."
                value={values.receiptFooter}
                onChange={(e) => set("receiptFooter", e.target.value)}
              />
            </Field>
            <Field label="Extra line" hint="Social media, website">
              <input
                className="input"
                maxLength={80}
                placeholder="e.g. IG @demomart  ·  www.demomart.ng"
                value={d.extraLine}
                onChange={(e) => setD("extraLine", e.target.value)}
              />
            </Field>
          </div>
          <div className="mt-2 divide-y divide-hairline">
            <Toggle checked={d.showBarcode} onChange={(v) => setD("showBarcode", v)} label="Print a barcode of the receipt number" description="Scan it later to find the sale quickly." />
          </div>
        </Card>

        <Card title="Printing">
          <div className="grid gap-3 sm:grid-cols-2">
            <Segmented
              label="Paper width"
              value={values.receiptWidth}
              options={[["80mm", "80mm (wide)"], ["58mm", "58mm (narrow)"]]}
              onChange={(v) => set("receiptWidth", v as Values["receiptWidth"])}
            />
          </div>
          <div className="mt-2 divide-y divide-hairline">
            <Toggle checked={values.receiptAutoPrint} onChange={(v) => set("receiptAutoPrint", v)} label="Print as soon as a sale is done" description="Leave off to save paper. Cashiers can still print or send on WhatsApp." />
          </div>
        </Card>
      </div>

      {/* ── Live preview ───────────────────────────────────────────────── */}
      <div className="lg:sticky lg:top-20 lg:self-start">
        <div className="rounded-3xl bg-ink-100 p-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-bold text-ink-900">Live preview</p>
            <p className="text-xs text-ink-500">Sample sale</p>
          </div>
          <div className="max-h-[70vh] overflow-y-auto pb-1">
            <div className="mx-auto w-fit shadow-[0_6px_20px_rgba(10,20,40,0.14)]">
              <ReceiptSheet
                data={data}
                org={{ ...org, logoUrl: logo }}
                branch={{ name: branchName }}
                settings={values}
                design={{ ...d, phones: d.phones.filter((p) => p.trim().length >= 5) }}
                stamp={stamp}
              />
              <div className="receipt-paper-edge" aria-hidden />
            </div>
          </div>
        </div>
      </div>

      {/* ── Save bar ───────────────────────────────────────────────────── */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-hairline bg-white/95 backdrop-blur lg:left-64">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <p className={`text-sm ${message ? (message.ok ? "text-good-700" : "text-sell-700") : "text-ink-500"}`}>
            {message?.text ?? (dirty ? "You have changes that are not saved yet." : "All changes saved.")}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => {
                setValues((s) => ({ ...s, design: DEFAULT_RECEIPT_DESIGN }));
                setMessage(null);
              }}
            >
              <RotateCcw className="size-4" />
              Reset look
            </button>
            <button type="button" className="btn btn-primary" disabled={!dirty || saving} onClick={save}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              Save design
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Card({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="card rounded-2xl p-5">
      <div className="mb-3">
        <h2 className="text-base font-bold text-ink-950">{title}</h2>
        {note ? <p className="text-sm text-ink-500">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Segmented({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <p className="mb-1 text-sm font-semibold text-ink-800">{label}</p>
      <div className="flex rounded-xl bg-canvas p-1 ring-1 ring-hairline">
        {options.map(([v, l]) => (
          <button
            key={v}
            type="button"
            aria-pressed={value === v}
            onClick={() => onChange(v)}
            className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors ${
              value === v ? "bg-white text-ink-950 shadow-sm" : "text-ink-600 hover:text-ink-950"
            }`}
          >
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A small drawing of each style so owners pick by eye, not by name. */
function StyleTile({ style, active, onPick }: { style: ReceiptStyle; active: boolean; onPick: () => void }) {
  const info = RECEIPT_STYLE_INFO[style];
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={active}
      className={`rounded-2xl border p-3 text-left transition ${
        active ? "border-navy-600 bg-navy-50 ring-2 ring-navy-600/20" : "border-hairline hover:border-navy-200"
      }`}
    >
      <div className="mx-auto mb-3 w-24 rounded-md bg-white p-2 shadow-sm ring-1 ring-hairline">
        <div className={`mx-auto mb-1.5 h-1.5 rounded-full bg-ink-900 ${style === "BOLD" ? "h-2.5 w-16" : "w-12"}`} />
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-ink-300" />
        <div className={`mb-1.5 ${style === "CLASSIC" ? "border-t border-dashed" : style === "BOLD" ? "border-t-2" : "border-t"} border-ink-900`} />
        {[0, 1, 2].map((i) => (
          <div key={i} className="mb-1 flex justify-between">
            <div className="h-1 w-10 rounded-full bg-ink-300" />
            <div className="h-1 w-4 rounded-full bg-ink-400" />
          </div>
        ))}
        {style === "BOLD" ? (
          <div className="mt-1.5 h-3 rounded-sm bg-ink-950" />
        ) : style === "MODERN" ? (
          <div className="mt-1.5 h-3 rounded-sm border-2 border-ink-900" />
        ) : (
          <div className="mt-1.5 flex justify-between border-t border-dashed border-ink-900 pt-1">
            <div className="h-1.5 w-6 rounded-full bg-ink-900" />
            <div className="h-1.5 w-5 rounded-full bg-ink-900" />
          </div>
        )}
      </div>
      <p className="flex items-center gap-1.5 text-sm font-bold text-ink-950">
        {active ? <Check className="size-4 text-navy-700" /> : null}
        {info.label}
      </p>
      <p className="mt-0.5 text-xs leading-snug text-ink-500">{info.hint}</p>
    </button>
  );
}
