"use client";

import { useCallback, useId, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Camera,
  CalendarDays,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  ImageUp,
  Loader2,
  Pencil,
  Plus,
  Search,
  ShoppingCart,
  Trash2,
  X,
} from "lucide-react";

import { compressImage, formatBytes, makeThumbnail } from "@/lib/imageCompress";
import { formatNaira, fromKobo } from "@/lib/money";
import type { ReceiptRow } from "@/lib/receipts";

/**
 * The receipts filing cabinet.
 *
 * Two jobs, and the screen is laid out around them in this order:
 *
 *   1. FIND a receipt. One search box that understands a supplier's name, our
 *      ID (RCT-000014), the number printed on the paper, or a purchase number.
 *      Nobody should have to pick "search by…" first.
 *
 *   2. FILE a receipt. Photograph it or pick a file, say who it is from, done.
 *      Only the supplier is required — a storekeeper with a delivery driver
 *      waiting will not fill in six fields, and a receipt filed with one field
 *      beats a receipt not filed at all.
 *
 * Photos are shrunk on the device before upload (see lib/imageCompress.ts), so
 * filing works on a weak signal and a page of receipts loads fast.
 */

interface SupplierOption {
  id: string;
  name: string;
}

interface Preset {
  open: boolean;
  supplierId: string | null;
  purchase: { id: string; reference: string } | null;
}

interface ListResult {
  items: ReceiptRow[];
  nextCursor: string | null;
  total: number;
}

/**
 * "14 Mar 2026", in the shop's own timezone. lib/dates.ts has the same helper
 * but is server-only, so the browser keeps this small copy.
 */
function formatDate(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-NG", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function fileUrl(id: string, mode?: "thumb" | "download"): string {
  const base = `/api/receipts/${id}/file`;
  if (mode === "thumb") return `${base}?thumb=1`;
  if (mode === "download") return `${base}?download=1`;
  return base;
}

export function ReceiptsClient({
  initial,
  suppliers,
  supplierNames,
  canManage,
  today,
  timezone,
  preset,
}: {
  initial: ListResult;
  suppliers: SupplierOption[];
  /** Saved suppliers plus names already typed on receipts, for suggestions and the filter. */
  supplierNames: string[];
  canManage: boolean;
  today: string;
  timezone: string;
  preset: Preset;
}) {
  const [items, setItems] = useState<ReceiptRow[]>(initial.items);
  const [nextCursor, setNextCursor] = useState<string | null>(initial.nextCursor);
  const [total, setTotal] = useState(initial.total);

  const [search, setSearch] = useState("");
  // The filter is by name, so names that are not saved suppliers ("Market") work too.
  const [supplierFilter, setSupplierFilter] = useState("");
  const [names, setNames] = useState(supplierNames);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [filing, setFiling] = useState(preset.open);
  const [viewing, setViewing] = useState<ReceiptRow | null>(null);
  const [editing, setEditing] = useState<ReceiptRow | null>(null);

  const filtered = search.trim() !== "" || supplierFilter !== "";
  // Whether the business has ever filed anything — decides between "nothing
  // matches" and the first-run welcome. Only the unfiltered count can say.
  const [everFiled, setEverFiled] = useState(initial.total > 0);

  // ── Search ────────────────────────────────────────────────────────────────
  // Typing waits 300ms before asking the server, and a newer request cancels an
  // older one, so results can never arrive out of order and overwrite a later
  // search with an earlier one.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setListError(null);
      try {
        const query = new URLSearchParams();
        if (search.trim()) query.set("q", search.trim());
        if (supplierFilter) query.set("supplier", supplierFilter);
        const res = await fetch(`/api/receipts?${query}`, { signal: controller.signal });
        if (!res.ok) throw new Error("bad response");
        const data = (await res.json()) as ListResult;
        setItems(data.items);
        setNextCursor(data.nextCursor);
        setTotal(data.total);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setListError("Couldn't search right now. Check your connection and try again.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [search, supplierFilter]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const query = new URLSearchParams({ cursor: nextCursor });
      if (search.trim()) query.set("q", search.trim());
      if (supplierFilter) query.set("supplier", supplierFilter);
      const res = await fetch(`/api/receipts?${query}`);
      if (!res.ok) throw new Error("bad response");
      const data = (await res.json()) as ListResult;
      setItems((current) => [...current, ...data.items]);
      setNextCursor(data.nextCursor);
    } catch {
      setListError("Couldn't load more. Check your connection and try again.");
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore, search, supplierFilter]);

  function onFiled(receipt: ReceiptRow) {
    setFiling(false);
    setEverFiled(true);
    setTotal((n) => n + 1);
    // Show it straight away if it belongs in the current view; otherwise the
    // person has a filter on and will see it when they clear it.
    rememberName(receipt.supplierName);
    const matchesSupplier = !supplierFilter || supplierFilter.toLowerCase() === receipt.supplierName.toLowerCase();
    if (matchesSupplier && !search.trim()) setItems((current) => [receipt, ...current]);
    // Drop ?new=1 from the address bar so a refresh doesn't reopen the sheet.
    if (preset.open) window.history.replaceState(null, "", "/receipts");
  }

  /** A newly typed name becomes a suggestion and a filter choice straight away. */
  function rememberName(name: string) {
    setNames((list) =>
      list.some((n) => n.toLowerCase() === name.toLowerCase()) ? list : [...list, name].sort((a, b) => a.localeCompare(b)),
    );
  }

  function onEdited(receipt: ReceiptRow) {
    rememberName(receipt.supplierName);
    setEditing(null);
    setItems((current) => current.map((r) => (r.id === receipt.id ? receipt : r)));
    setViewing((current) => (current?.id === receipt.id ? receipt : current));
  }

  function onDeleted(id: string) {
    setViewing(null);
    setItems((current) => current.filter((r) => r.id !== id));
    setTotal((n) => Math.max(0, n - 1));
  }

  function closeFiling() {
    setFiling(false);
    if (preset.open) window.history.replaceState(null, "", "/receipts");
  }

  return (
    <div className="space-y-4">
      {/* Find first, file second — but the file button is the one bold thing. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by supplier name, receipt ID or number…"
            className="input h-10 w-full pl-9"
            aria-label="Search receipts"
          />
          {loading ? (
            <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-ink-400" />
          ) : null}
        </div>

        <select
          value={supplierFilter}
          onChange={(e) => setSupplierFilter(e.target.value)}
          className="select h-10 w-full sm:w-56"
          aria-label="Filter by supplier"
        >
          <option value="">All suppliers</option>
          {names.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>

        {canManage ? (
          <button type="button" onClick={() => setFiling(true)} className="btn btn-primary h-10">
            <Plus className="size-4" />
            File a receipt
          </button>
        ) : null}
      </div>

      {listError ? (
        <p className="rounded-lg border border-bad-200 bg-bad-50 px-3 py-2 text-sm font-medium text-bad-700">
          {listError}
        </p>
      ) : null}

      {everFiled ? (
        <p className="text-xs font-semibold text-ink-500" aria-live="polite">
          {filtered
            ? `${total} matching receipt${total === 1 ? "" : "s"}`
            : `${total} receipt${total === 1 ? "" : "s"} on file`}
        </p>
      ) : null}

      {!everFiled ? (
        <FirstRun canManage={canManage} onFile={() => setFiling(true)} />
      ) : items.length === 0 ? (
        <p className="card card-pad text-center text-sm text-ink-500">
          No receipts match that search. Try the supplier&apos;s name or a receipt ID like RCT-000014.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {items.map((r) => (
              <ReceiptCard key={r.id} receipt={r} timezone={timezone} onOpen={() => setViewing(r)} />
            ))}
          </div>
          {nextCursor ? (
            <div className="flex justify-center pt-1">
              <button type="button" onClick={loadMore} disabled={loadingMore} className="btn btn-outline">
                {loadingMore ? <Loader2 className="size-4 animate-spin" /> : null}
                Show more
              </button>
            </div>
          ) : null}
        </>
      )}

      {filing ? (
        <FileSheet
          names={names}
          today={today}
          presetSupplierName={suppliers.find((x) => x.id === preset.supplierId)?.name ?? null}
          presetPurchase={preset.purchase}
          onClose={closeFiling}
          onFiled={onFiled}
        />
      ) : null}

      {viewing ? (
        <Viewer
          receipt={viewing}
          timezone={timezone}
          canManage={canManage}
          onClose={() => setViewing(null)}
          onEdit={() => setEditing(viewing)}
          onDeleted={onDeleted}
        />
      ) : null}

      {editing ? (
        <EditSheet
          receipt={editing}
          names={names}
          onClose={() => setEditing(null)}
          onSaved={onEdited}
        />
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Card
// ─────────────────────────────────────────────────────────────────────────────

function ReceiptCard({
  receipt: r,
  timezone,
  onOpen,
}: {
  receipt: ReceiptRow;
  timezone: string;
  onOpen: () => void;
}) {
  const isPdf = r.fileMime === "application/pdf";
  return (
    <button
      type="button"
      onClick={onOpen}
      className="card group flex flex-col overflow-hidden text-left transition-shadow hover:shadow-[var(--shadow-raised)]"
      aria-label={`Open receipt ${r.reference} from ${r.supplierName}`}
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden border-b border-hairline bg-navy-50">
        {r.hasThumb ? (
          // A plain <img>: the file sits behind an authenticated route, already
          // sized and compressed, so the Next image optimizer has nothing to add.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={fileUrl(r.id, "thumb")}
            alt=""
            loading="lazy"
            decoding="async"
            className="size-full object-cover object-top"
          />
        ) : (
          <div className="grid size-full place-items-center text-navy-300">
            <FileText className="size-10" />
          </div>
        )}
        <span className="badge badge-navy absolute left-2 top-2 shadow-[var(--shadow-card)]">
          {r.reference}
        </span>
        {isPdf ? <span className="badge badge-bad absolute right-2 top-2">PDF</span> : null}
      </div>

      <div className="flex flex-1 flex-col gap-1 p-3">
        <p className="truncate text-sm font-bold text-ink-950">{r.supplierName}</p>
        <p className="truncate text-xs text-ink-500">
          {r.receiptNo ? `No. ${r.receiptNo}` : "No receipt number"}
        </p>
        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <span className="inline-flex items-center gap-1 text-xs text-ink-500">
            <CalendarDays className="size-3.5" />
            {formatDate(r.receiptDate, timezone)}
          </span>
          {r.amountKobo !== null ? (
            <span className="tabular text-sm font-bold text-ink-950">{formatNaira(r.amountKobo)}</span>
          ) : null}
        </div>
      </div>
    </button>
  );
}

function FirstRun({
  canManage,
    onFile,
}: {
  canManage: boolean;
  onFile: () => void;
}) {
  return (
    <div className="card card-pad text-center">
      <div className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-navy-50">
        <FolderOpen className="size-6 text-navy-600" />
      </div>
      <p className="text-sm font-semibold text-ink-900">No receipts filed yet</p>
      <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-ink-500">
        When a vendor delivers, or you buy from the market, snap the receipt here. You can find it
        later by the supplier&apos;s name or its ID, even years from now.
      </p>
      {canManage ? (
        <button type="button" onClick={onFile} className="btn btn-primary mt-4">
          <Camera className="size-4" />
          File your first receipt
        </button>
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared bits
// ─────────────────────────────────────────────────────────────────────────────

function Sheet({
  title,
  onClose,
  wide,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  wide?: boolean;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/50 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`animate-slide-up flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-surface shadow-xl sm:rounded-2xl ${
          wide ? "max-w-4xl" : "max-w-lg"
        }`}
      >
        <div className="flex items-center justify-between border-b border-hairline p-4">
          <h2 className="text-base font-bold text-ink-950">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-icon text-ink-500 hover:text-ink-900"
            aria-label="Close"
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer ? <div className="border-t border-hairline p-4">{footer}</div> : null}
      </div>
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
        {hint && !error ? <span className="text-xs text-ink-400">{hint}</span> : null}
      </span>
      {children}
      {error ? <span className="mt-1 block text-xs font-medium text-bad-700">{error}</span> : null}
    </label>
  );
}

interface ApiFailure {
  error?: string;
  fields?: Record<string, string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// File a receipt
// ─────────────────────────────────────────────────────────────────────────────

interface Picked {
  blob: Blob;
  thumb: Blob | null;
  previewUrl: string | null;
  name: string;
  originalBytes: number;
  isPdf: boolean;
}

function FileSheet({
  names,
  today,
  presetSupplierName,
  presetPurchase,
  onClose,
  onFiled,
}: {
  names: string[];
  today: string;
  presetSupplierName: string | null;
  presetPurchase: { id: string; reference: string } | null;
  onClose: () => void;
  onFiled: (receipt: ReceiptRow) => void;
}) {
  const [picked, setPicked] = useState<Picked | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [supplierName, setSupplierName] = useState(presetSupplierName ?? "");
  const [receiptNo, setReceiptNo] = useState("");
  const [receiptDate, setReceiptDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const cameraInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Preview URLs hold the picture in memory until released.
  const previewUrl = picked?.previewUrl ?? null;
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  async function onPick(file: File | undefined) {
    if (!file) return;
    setError(null);
    setFieldErrors({});
    setPreparing(true);
    try {
      const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
      if (isPdf) {
        if (file.size > 5_000_000) {
          throw new Error("That PDF is over 5 MB. Photograph the pages instead.");
        }
        setPicked({
          blob: file,
          thumb: null,
          previewUrl: null,
          name: file.name,
          originalBytes: file.size,
          isPdf: true,
        });
        return;
      }
      const compressed = await compressImage(file);
      const thumb = await makeThumbnail(compressed.blob);
      setPicked({
        blob: compressed.blob,
        thumb,
        previewUrl: URL.createObjectURL(compressed.blob),
        name: file.name,
        originalBytes: compressed.originalBytes,
        isPdf: false,
      });
    } catch (e) {
      setPicked(null);
      setError(e instanceof Error ? e.message : "That file can't be used. Try another.");
    } finally {
      setPreparing(false);
    }
  }

  async function submit() {
    if (!picked) {
      setError("Take a photo of the receipt, or choose a file.");
      return;
    }
    if (!supplierName.trim()) {
      setFieldErrors({ supplierName: "Type who it is from" });
      return;
    }
    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      const body = new FormData();
      const ext = picked.isPdf ? "pdf" : picked.blob.type === "image/webp" ? "webp" : "jpg";
      body.set("file", picked.blob, `receipt.${ext}`);
      if (picked.thumb) body.set("thumb", picked.thumb, "thumb.webp");
      body.set("supplierName", supplierName.trim());
      body.set("receiptNo", receiptNo);
      body.set("receiptDate", receiptDate);
      body.set("amount", amount);
      body.set("note", note);
      body.set("originalBytes", String(picked.originalBytes));
      if (presetPurchase) body.set("purchaseId", presetPurchase.id);

      const res = await fetch("/api/receipts", { method: "POST", body });
      if (res.ok) {
        const data = (await res.json()) as { receipt: ReceiptRow };
        onFiled(data.receipt);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as ApiFailure;
      setError(data.error ?? "Couldn't file the receipt. Please try again.");
      if (data.fields) setFieldErrors(data.fields);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  const saved = picked && !picked.isPdf ? picked.originalBytes - picked.blob.size : 0;

  return (
    <Sheet
      title="File a receipt"
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-ghost" disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            className="btn btn-primary"
            disabled={saving || preparing || !picked}
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            {saving ? "Filing…" : "File receipt"}
          </button>
        </div>
      }
    >
      <div className="space-y-4 p-4">
        {presetPurchase ? (
          <p className="flex items-center gap-2 rounded-lg border border-navy-100 bg-navy-50 px-3 py-2 text-sm font-medium text-navy-800">
            <ShoppingCart className="size-4 shrink-0" />
            This receipt will be attached to purchase {presetPurchase.reference}.
          </p>
        ) : null}

        {/* Hidden inputs — one opens the camera on a phone, one the file picker. */}
        <input
          ref={cameraInput}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            void onPick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/*,application/pdf"
          className="hidden"
          onChange={(e) => {
            void onPick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />

        {picked ? (
          <div className="flex gap-3 rounded-xl border border-hairline bg-ink-50 p-3">
            <div className="grid size-24 shrink-0 place-items-center overflow-hidden rounded-lg border border-hairline bg-surface">
              {picked.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={picked.previewUrl} alt="Receipt preview" className="size-full object-cover" />
              ) : (
                <FileText className="size-8 text-ink-400" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink-900">{picked.name}</p>
              {picked.isPdf ? (
                <p className="mt-0.5 text-xs text-ink-500">PDF · {formatBytes(picked.blob.size)}</p>
              ) : saved > 0 ? (
                <p className="mt-0.5 text-xs text-ink-500">
                  Shrunk from {formatBytes(picked.originalBytes)} to{" "}
                  <span className="font-bold text-good-700">{formatBytes(picked.blob.size)}</span>, still
                  sharp enough to read
                </p>
              ) : (
                <p className="mt-0.5 text-xs text-ink-500">{formatBytes(picked.blob.size)}</p>
              )}
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="mt-2 text-xs font-bold text-navy-700 underline-offset-2 hover:underline"
              >
                Use a different file
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border-2 border-dashed border-ink-200 p-5 text-center">
            {preparing ? (
              <p className="flex items-center justify-center gap-2 py-4 text-sm font-semibold text-ink-600">
                <Loader2 className="size-4 animate-spin" />
                Preparing the photo…
              </p>
            ) : (
              <>
                <p className="text-sm font-semibold text-ink-900">Add the receipt</p>
                <p className="mt-0.5 text-xs text-ink-500">A photo or a PDF. Large photos are shrunk for you.</p>
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => cameraInput.current?.click()}
                    className="btn btn-navy"
                  >
                    <Camera className="size-4" />
                    Take photo
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInput.current?.click()}
                    className="btn btn-outline"
                  >
                    <ImageUp className="size-4" />
                    Choose file
                  </button>
                </div>
              </>
            )}
            {fieldErrors.file ? (
              <p className="mt-2 text-xs font-medium text-bad-700">{fieldErrors.file}</p>
            ) : null}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Supplier"
            hint="Type any name"
            error={fieldErrors.supplierName}
            className="sm:col-span-2"
          >
            <SupplierNameInput
              value={supplierName}
              onChange={setSupplierName}
              names={names}
              disabled={presetPurchase !== null && supplierName !== ""}
            />
          </Field>

          <Field label="Receipt number" hint="If it has one" error={fieldErrors.receiptNo}>
            <input
              value={receiptNo}
              onChange={(e) => setReceiptNo(e.target.value)}
              className="input"
              placeholder="e.g. INV-20418"
              maxLength={80}
            />
          </Field>

          <Field label="Date on receipt" error={fieldErrors.receiptDate}>
            <input
              type="date"
              value={receiptDate}
              max={today}
              onChange={(e) => setReceiptDate(e.target.value)}
              className="input"
            />
          </Field>

          <Field label="Amount" hint="Optional" error={fieldErrors.amount}>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="input tabular"
              inputMode="decimal"
              placeholder="₦"
            />
          </Field>

          <Field label="Note" hint="Optional" error={fieldErrors.note}>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="input"
              placeholder="e.g. 20 cartons of Indomie"
              maxLength={1000}
            />
          </Field>
        </div>

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
// View
// ─────────────────────────────────────────────────────────────────────────────

function Viewer({
  receipt: r,
  timezone,
  canManage,
  onClose,
  onEdit,
  onDeleted,
}: {
  receipt: ReceiptRow;
  timezone: string;
  canManage: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDeleted: (id: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isPdf = r.fileMime === "application/pdf";

  async function remove() {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/receipts/${r.id}`, { method: "DELETE" });
      if (res.ok) {
        onDeleted(r.id);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as ApiFailure;
      setError(data.error ?? "Couldn't delete the receipt. Please try again.");
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setDeleting(false);
    }
  }

  const details: [string, React.ReactNode][] = [
    ["Supplier", r.supplierName],
    ["Receipt ID", <span key="ref" className="font-mono">{r.reference}</span>],
    ["Receipt number", r.receiptNo ?? "—"],
    ["Date on receipt", formatDate(r.receiptDate, timezone)],
    ["Amount", r.amountKobo !== null ? formatNaira(r.amountKobo) : "—"],
  ];

  return (
    <Sheet title={`${r.reference} · ${r.supplierName}`} onClose={onClose} wide>
      <div className="grid md:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="grid min-h-64 place-items-center bg-ink-100 p-3">
          {isPdf ? (
            <div className="py-10 text-center">
              <FileText className="mx-auto size-12 text-ink-400" />
              <p className="mt-2 text-sm font-semibold text-ink-700">PDF document</p>
              <a href={fileUrl(r.id)} target="_blank" rel="noreferrer" className="btn btn-navy mt-3">
                <ExternalLink className="size-4" />
                Open PDF
              </a>
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={fileUrl(r.id)}
              alt={`Receipt ${r.reference} from ${r.supplierName}`}
              className="max-h-[70dvh] w-auto max-w-full rounded-lg bg-surface shadow-[var(--shadow-raised)]"
            />
          )}
        </div>

        <div className="space-y-4 border-t border-hairline p-4 md:border-l md:border-t-0">
          <dl className="space-y-2.5">
            {details.map(([label, value]) => (
              <div key={label}>
                <dt className="text-[0.6875rem] font-bold uppercase tracking-wider text-ink-500">{label}</dt>
                <dd className="text-sm font-semibold text-ink-950">{value}</dd>
              </div>
            ))}
            {r.purchaseId ? (
              <div>
                <dt className="text-[0.6875rem] font-bold uppercase tracking-wider text-ink-500">Purchase</dt>
                <dd>
                  <Link
                    href={`/purchases/${r.purchaseId}`}
                    className="text-sm font-bold text-navy-700 underline-offset-2 hover:underline"
                  >
                    {r.purchaseReference ?? "View purchase"}
                  </Link>
                </dd>
              </div>
            ) : null}
            {r.note ? (
              <div>
                <dt className="text-[0.6875rem] font-bold uppercase tracking-wider text-ink-500">Note</dt>
                <dd className="text-sm text-ink-800">{r.note}</dd>
              </div>
            ) : null}
          </dl>

          <p className="text-xs leading-relaxed text-ink-500">
            Filed {formatDate(r.createdAt, timezone)}
            {r.uploadedByName ? ` by ${r.uploadedByName}` : ""} · {formatBytes(r.fileBytes)}
            {r.originalBytes > r.fileBytes ? ` (was ${formatBytes(r.originalBytes)})` : ""}
          </p>

          <div className="flex flex-wrap gap-2">
            <a href={fileUrl(r.id)} target="_blank" rel="noreferrer" className="btn btn-outline btn-sm">
              <ExternalLink className="size-4" />
              Full size
            </a>
            <a href={fileUrl(r.id, "download")} className="btn btn-outline btn-sm">
              <Download className="size-4" />
              Download
            </a>
            {canManage ? (
              <button type="button" onClick={onEdit} className="btn btn-outline btn-sm">
                <Pencil className="size-4" />
                Edit details
              </button>
            ) : null}
          </div>

          {canManage ? (
            confirming ? (
              <div className="rounded-lg border border-bad-200 bg-bad-50 p-3">
                <p className="text-sm font-semibold text-bad-700">
                  Delete this receipt for good? The file can&apos;t be brought back.
                </p>
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={remove} disabled={deleting} className="btn btn-danger btn-sm">
                    {deleting ? <Loader2 className="size-4 animate-spin" /> : null}
                    Yes, delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(false)}
                    disabled={deleting}
                    className="btn btn-ghost btn-sm"
                  >
                    Keep it
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-bad-700 underline-offset-2 hover:underline"
              >
                <Trash2 className="size-3.5" />
                Delete receipt
              </button>
            )
          ) : null}

          {error ? (
            <p role="alert" className="text-sm font-medium text-bad-700">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </Sheet>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Edit details
// ─────────────────────────────────────────────────────────────────────────────

function EditSheet({
  receipt: r,
  names,
  onClose,
  onSaved,
}: {
  receipt: ReceiptRow;
  names: string[];
  onClose: () => void;
  onSaved: (receipt: ReceiptRow) => void;
}) {
  const [supplierName, setSupplierName] = useState(r.supplierName);
  const [receiptNo, setReceiptNo] = useState(r.receiptNo ?? "");
  const [receiptDate, setReceiptDate] = useState(r.receiptDate.slice(0, 10));
  const [amount, setAmount] = useState(r.amountKobo !== null ? String(fromKobo(r.amountKobo)) : "");
  const [note, setNote] = useState(r.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function submit() {
    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      const res = await fetch(`/api/receipts/${r.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          supplierName: supplierName.trim(),
          receiptNo: receiptNo.trim() || null,
          receiptDate,
          amount: amount.trim() || null,
          note: note.trim() || null,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { receipt: ReceiptRow };
        onSaved(data.receipt);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as ApiFailure;
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
      title={`Edit ${r.reference}`}
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-ghost" disabled={saving}>
            Cancel
          </button>
          <button type="button" onClick={submit} className="btn btn-primary" disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Save changes
          </button>
        </div>
      }
    >
      <div className="grid gap-3 p-4 sm:grid-cols-2">
        <Field label="Supplier" hint="Type any name" error={fieldErrors.supplierName} className="sm:col-span-2">
          <SupplierNameInput value={supplierName} onChange={setSupplierName} names={names} />
        </Field>
        <Field label="Receipt number" error={fieldErrors.receiptNo}>
          <input value={receiptNo} onChange={(e) => setReceiptNo(e.target.value)} className="input" maxLength={80} />
        </Field>
        <Field label="Date on receipt" error={fieldErrors.receiptDate}>
          <input
            type="date"
            value={receiptDate}
            onChange={(e) => setReceiptDate(e.target.value)}
            className="input"
          />
        </Field>
        <Field label="Amount" error={fieldErrors.amount}>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="input tabular"
            inputMode="decimal"
            placeholder="₦"
          />
        </Field>
        <Field label="Note" error={fieldErrors.note}>
          <input value={note} onChange={(e) => setNote(e.target.value)} className="input" maxLength={1000} />
        </Field>
        {error ? (
          <p role="alert" className="rounded-lg border border-bad-200 bg-bad-50 px-3 py-2 text-sm font-medium text-bad-700 sm:col-span-2">
            {error}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}

/**
 * Who a receipt is from, typed freely. Saved suppliers and names used before
 * are suggested as you type, so "Market" or "Alhaji Musa" can be filed and
 * found again without first being added as a supplier.
 */
function SupplierNameInput({
  value,
  onChange,
  names,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  names: string[];
  disabled?: boolean;
}) {
  const listId = useId();
  return (
    <>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        list={listId}
        className="input"
        placeholder="e.g. Market, Alhaji Musa Ventures, Emzor"
        maxLength={120}
        autoComplete="off"
        disabled={disabled}
      />
      <datalist id={listId}>
        {names.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
    </>
  );
}
