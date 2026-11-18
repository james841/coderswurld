"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, UploadCloud } from "lucide-react";

import { ProductInputSchema } from "@/lib/productInput";

/**
 * The Excel import screen.
 *
 * WHERE THE WORK HAPPENS
 * ----------------------
 * The file is parsed **in the browser**. A 4,000-row sheet never uploads as a
 * file — it is read here, its columns matched to our fields, and then posted as
 * already-normalised rows in chunks of 500. That keeps every request small, lets
 * the progress bar move, and means a shop's entire price list isn't sitting in a
 * temp directory somewhere.
 *
 * ExcelJS does the parsing, not SheetJS: it reads the same `.xlsx` a shopkeeper
 * actually has (the one Excel saved), and it gives us the cell values as plain
 * data rather than a workbook object we'd have to walk.
 *
 * WHY ROWS ARRIVE WITH A ROW NUMBER
 * ---------------------------------
 * Each row is posted with `__row` set to the line the person sees in Excel, so a
 * failure says "row 214" and not "row 3 of chunk 2". Without that, fixing a bad
 * import means hunting for which line the software meant.
 */
export interface ImportResult {
  received: number;
  created: number;
  updated: number;
  failed: number;
  errors: { row: number; name: string | null; message: string }[];
}

/** One field we can import, with the header names a person might have used. */
const COLUMNS: { key: string; label: string; aliases: string[]; required?: boolean }[] = [
  { key: "name", label: "Product name", aliases: ["name", "product", "product name", "item", "description"], required: true },
  { key: "sku", label: "Stock code", aliases: ["sku", "code", "stock code", "item code"] },
  { key: "barcode", label: "Barcode", aliases: ["barcode", "bar code", "ean", "upc"] },
  { key: "category", label: "Category", aliases: ["category", "group", "type", "department"] },
  { key: "supplier", label: "Bought from", aliases: ["supplier", "market", "vendor", "bought from", "source"] },
  { key: "unit", label: "Unit", aliases: ["unit", "pack", "uom"] },
  { key: "packSize", label: "Pack size", aliases: ["pack size", "size", "packsize"] },
  { key: "costPrice", label: "Cost price", aliases: ["cost", "cost price", "buying price", "purchase price"] },
  { key: "sellingPrice", label: "Selling price", aliases: ["selling price", "price", "retail price", "selling"] },
  { key: "wholesalePrice", label: "Wholesale price", aliases: ["wholesale", "wholesale price", "bulk price"] },
  { key: "wholesaleMinQty", label: "Wholesale from", aliases: ["wholesale qty", "wholesale from", "bulk qty", "wholesale min"] },
  { key: "openingStock", label: "Quantity in stock", aliases: ["quantity", "qty", "stock", "opening stock", "in stock"] },
  { key: "minStock", label: "Warn at", aliases: ["min stock", "minstock", "reorder level", "warn at", "low stock"] },
  { key: "expiryDate", label: "Expiry date", aliases: ["expiry", "expiry date", "expires", "best before"] },
  { key: "description", label: "Notes", aliases: ["notes", "note", "details", "description note"] },
];

const CHUNK = 500;
const MAX_BYTES = 8 * 1024 * 1024;

export function ImportClient() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [firstRowNumber, setFirstRowNumber] = useState(2);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Reading the file ──────────────────────────────────────────────────────
  async function pick(file: File) {
    setError(null);
    setResult(null);
    setRows([]);
    setHeaders([]);
    setMapping({});

    if (file.size > MAX_BYTES) {
      setError("That file is over 8 MB. Split it into two and import them one after the other.");
      return;
    }

    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const sheet = wb.worksheets[0];
      if (!sheet) {
        setError("That file has no sheets in it.");
        return;
      }

      // Find the header row: the first row in the top ten that maps to at least
      // two known fields. Shopkeepers routinely have a title and a blank line
      // above the real headers, and assuming row 1 is the header would silently
      // import the title as a product.
      let headerRowIndex = 1;
      let best: { index: number; found: number } | null = null;
      for (let r = 1; r <= Math.min(10, sheet.rowCount); r++) {
        const cells = rowValues(sheet.getRow(r));
        const found = cells.filter((c) => c && matchColumn(c) !== null).length;
        if (found >= 2 && (!best || found > best.found)) best = { index: r, found };
      }
      if (!best) {
        setError(
          "Couldn't find the column headings. Make sure your sheet has a row like Name, Price, Quantity near the top.",
        );
        return;
      }
      headerRowIndex = best.index;

      const headerCells = rowValues(sheet.getRow(headerRowIndex));
      const labels = headerCells.map((c, i) => c ?? `Column ${i + 1}`);
      setHeaders(labels);
      setFirstRowNumber(headerRowIndex + 1);

      const auto: Record<string, number> = {};
      for (const col of COLUMNS) {
        const target = col.aliases;
        const idx = headerCells.findIndex((c) => {
          if (!c) return false;
          const key = c.toLowerCase().trim();
          return target.includes(key);
        });
        if (idx >= 0) auto[col.key] = idx;
      }
      if (auto.name === undefined) {
        auto.name = headerCells.findIndex((c) => (c ?? "").toLowerCase().includes("name"));
      }
      setMapping(auto);

      const collected: Record<string, unknown>[] = [];
      for (let r = headerRowIndex + 1; r <= sheet.rowCount; r++) {
        const cells = rowValues(sheet.getRow(r));
        if (cells.every((c) => c === null || c === "")) continue; // blank line
        collected.push(Object.fromEntries(cells.map((c, i) => [String(i), c])));
      }
      setRows(collected);
      setFileName(file.name);
    } catch {
      setError("Couldn't read that file. Save it as .xlsx from Excel and try again.");
    }
  }

  // ── Importing ─────────────────────────────────────────────────────────────
  async function run() {
    if (rows.length === 0) return;
    if (mapping.name === undefined) {
      setError("Tell us which column holds the product name.");
      return;
    }

    setBusy(true);
    setError(null);
    setResult(null);

    const payload = rows.map((row, i) => {
      const out: Record<string, unknown> = { __row: firstRowNumber + i };
      for (const col of COLUMNS) {
        const idx = mapping[col.key];
        if (idx === undefined) continue;
        const value = row[String(idx)];
        if (value === null || value === undefined || value === "") continue;
        out[col.key] = value;
      }
      return out;
    });

    const total = payload.length;
    setProgress({ done: 0, total });

    const total_ = { created: 0, updated: 0, failed: 0, errors: [] as ImportResult["errors"] };
    try {
      for (let offset = 0; offset < total; offset += CHUNK) {
        const slice = payload.slice(offset, offset + CHUNK);
        const res = await fetch("/api/products/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: slice }),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          setError(
            (body as { error?: string } | null)?.error ??
              `Import stopped at row ${firstRowNumber + offset}. Nothing after that was saved.`,
          );
          setBusy(false);
          return;
        }
        const chunk = body as ImportResult;
        total_.created += chunk.created;
        total_.updated += chunk.updated;
        total_.failed += chunk.failed;
        total_.errors.push(...chunk.errors);
        setProgress({ done: Math.min(offset + CHUNK, total), total });
      }

      setResult({
        received: total,
        created: total_.created,
        updated: total_.updated,
        failed: total_.failed,
        errors: total_.errors,
      });
      setBusy(false);
      router.refresh();
    } catch {
      setError("The connection dropped part-way. Rows already saved are safe — re-importing won't double them.");
      setBusy(false);
    }
  }

  function reset() {
    setRows([]);
    setHeaders([]);
    setMapping({});
    setFileName(null);
    setResult(null);
    setError(null);
    setProgress({ done: 0, total: 0 });
    if (fileRef.current) fileRef.current.value = "";
  }

  const mappedCount = COLUMNS.filter((c) => mapping[c.key] !== undefined).length;

  return (
    <div className="space-y-4">
      {/* ── Step 1: the file ───────────────────────────────────────────────── */}
      <section className="card card-pad">
        <h2 className="section-title mb-3">1. Choose your spreadsheet</h2>

        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void pick(file);
          }}
        />

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files?.[0];
            if (file) void pick(file);
          }}
          className="rounded-xl border border-dashed border-ink-300 bg-ink-50/50 p-6 text-center"
        >
          <UploadCloud className="mx-auto size-7 text-ink-400" />
          <p className="mt-2 text-sm font-semibold text-ink-800">
            {fileName ?? "Drop your file here"}
          </p>
          <p className="mt-1 text-sm text-ink-500">
            Excel (.xlsx) or CSV, up to 8 MB. Nothing is uploaded until you press
            Import.
          </p>
          <div className="mt-3 flex justify-center gap-2">
            <button type="button" className="btn btn-outline btn-sm" onClick={() => fileRef.current?.click()}>
              Browse for a file
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void downloadTemplate()}>
              <FileSpreadsheet className="size-4" />
              Download a template
            </button>
          </div>
        </div>

        {error && (
          <p className="mt-3 rounded-lg border border-bad-200 bg-bad-50 px-3 py-2 text-sm text-bad-700">
            {error}
          </p>
        )}
      </section>

      {/* ── Step 2: match the columns ──────────────────────────────────────── */}
      {headers.length > 0 && (
        <section className="card card-pad">
          <h2 className="section-title mb-1">2. Match your columns</h2>
          <p className="mb-3 text-sm text-ink-500">
            We guessed from your headings — {mappedCount} of {COLUMNS.length} matched.
            Check them and fix any that landed in the wrong place.
          </p>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {COLUMNS.map((col) => (
              <div key={col.key}>
                <label className="label" htmlFor={`map-${col.key}`}>
                  {col.label}
                  {col.required && <span className="ml-1 text-bad-500">*</span>}
                </label>
                <select
                  id={`map-${col.key}`}
                  className="select"
                  value={mapping[col.key] ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setMapping((prev) => {
                      const next = { ...prev };
                      if (v === "") delete next[col.key];
                      else next[col.key] = Number(v);
                      return next;
                    });
                  }}
                >
                  <option value="">Not in my sheet</option>
                  {headers.map((h, i) => (
                    <option key={i} value={i}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {/* Preview — the five rows that show whether the mapping is right. */}
          {mapping.name !== undefined && rows.length > 0 && (
            <div className="mt-4 overflow-x-auto rounded-lg border border-ink-100">
              <table className="data-table">
                <thead>
                  <tr>
                    {COLUMNS.filter((c) => mapping[c.key] !== undefined).map((c) => (
                      <th key={c.key}>{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 5).map((row, i) => (
                    <tr key={i}>
                      {COLUMNS.filter((c) => mapping[c.key] !== undefined).map((c) => (
                        <td key={c.key}>{display(row[String(mapping[c.key])])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 5 && (
                <p className="border-t border-ink-100 px-3 py-2 text-xs text-ink-500">
                  …and {(rows.length - 5).toLocaleString("en-NG")} more rows.
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {/* ── Step 3: import ────────────────────────────────────────────────── */}
      {rows.length > 0 && (
        <section className="card card-pad">
          <h2 className="section-title mb-3">3. Import</h2>

          {busy ? (
            <div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
                <div
                  className="h-full rounded-full bg-brand-700 transition-[width] duration-200"
                  style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }}
                />
              </div>
              <p className="mt-2 text-sm text-ink-600">
                Saving {progress.done.toLocaleString("en-NG")} of{" "}
                {progress.total.toLocaleString("en-NG")}…
              </p>
            </div>
          ) : result ? (
            <ResultPanel result={result} onAgain={reset} onDone={() => router.push("/products")} />
          ) : (
            <>
              <p className="text-sm text-ink-600">
                {rows.length.toLocaleString("en-NG")} row
                {rows.length === 1 ? "" : "s"} ready. Products already in your
                catalogue — matched by barcode, then stock code — are updated;
                the rest are added. Re-importing never changes stock levels on
                products you already have.
              </p>
              <div className="mt-3 flex gap-2">
                <button type="button" className="btn btn-primary" onClick={() => void run()}>
                  Import {rows.length.toLocaleString("en-NG")} rows
                </button>
                <button type="button" className="btn btn-ghost" onClick={reset}>
                  Start over
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pieces
// ─────────────────────────────────────────────────────────────────────────────

function ResultPanel({
  result,
  onAgain,
  onDone,
}: {
  result: ImportResult;
  onAgain: () => void;
  onDone: () => void;
}) {
  const clean = result.failed === 0;
  return (
    <div>
      <p className={`text-base font-semibold ${clean ? "text-good-700" : "text-ink-900"}`}>
        {clean
          ? "Everything imported."
          : `Imported ${result.created + result.updated} of ${result.received} rows.`}
      </p>
      <div className="mt-2 flex flex-wrap gap-4 text-sm text-ink-600">
        <span>
          <span className="tabular font-semibold text-ink-900">{result.created}</span> new
        </span>
        <span>
          <span className="tabular font-semibold text-ink-900">{result.updated}</span> updated
        </span>
        {result.failed > 0 && (
          <span className="text-bad-700">
            <span className="tabular font-semibold">{result.failed}</span> skipped
          </span>
        )}
      </div>

      {result.errors.length > 0 && (
        <div className="mt-3 rounded-lg border border-bad-200 bg-bad-50 p-3">
          <p className="text-sm font-semibold text-bad-700">
            These rows need fixing — everything else was saved.
          </p>
          <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto text-sm text-bad-700">
            {result.errors.map((e, i) => (
              <li key={i}>
                <span className="font-semibold">Row {e.row}</span>
                {e.name ? ` · ${e.name}` : ""} — {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <button type="button" className="btn btn-primary" onClick={onDone}>
          Go to products
        </button>
        <button type="button" className="btn btn-outline" onClick={onAgain}>
          Import another file
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** One row's cells as strings. ExcelJS returns numbers, dates and rich text. */
function rowValues(row: { getCell: (n: number) => { value: unknown } }): (string | null)[] {
  const out: (string | null)[] = [];
  const count = (row as unknown as { cellCount: number }).cellCount ?? 0;
  for (let c = 1; c <= count; c++) {
    out.push(toText(row.getCell(c).value));
  }
  // Trim trailing empties so `every(c => null)` detects a blank line.
  while (out.length > 0 && (out[out.length - 1] === null || out[out.length - 1] === "")) {
    out.pop();
  }
  return out;
}

function toText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) {
    // Excel dates arrive as Date. "2026-03-15" is what the import expects.
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "object") {
    const obj = value as {
      text?: string;
      result?: unknown;
      richText?: { text: string }[];
      formula?: string;
    };
    if (Array.isArray(obj.richText)) return obj.richText.map((r) => r.text).join("").trim() || null;
    if (obj.result !== undefined) return toText(obj.result);
    if (typeof obj.text === "string") return obj.text.trim() || null;
  }
  return null;
}

function matchColumn(header: string): string | null {
  const key = header.toLowerCase().trim();
  for (const col of COLUMNS) {
    if (col.aliases.includes(key)) return col.key;
  }
  return null;
}

function display(value: unknown): string {
  const text = toText(value);
  return text ?? "—";
}

/**
 * A starter sheet, built with ExcelJS so it is a file Excel and the importer both
 * actually accept — one header row, then three examples that show the shape of a
 * price and a date without implying they're real products to keep.
 */
async function downloadTemplate(): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Products");

  sheet.columns = [
    { header: "Product name", key: "name", width: 32 },
    { header: "Stock code", key: "sku", width: 16 },
    { header: "Barcode", key: "barcode", width: 16 },
    { header: "Category", key: "category", width: 16 },
    { header: "Bought from", key: "supplier", width: 20 },
    { header: "Unit", key: "unit", width: 10 },
    { header: "Pack size", key: "packSize", width: 12 },
    { header: "Cost price", key: "costPrice", width: 12 },
    { header: "Selling price", key: "sellingPrice", width: 14 },
    { header: "Wholesale price", key: "wholesalePrice", width: 15 },
    { header: "Wholesale from", key: "wholesaleMinQty", width: 15 },
    { header: "Quantity in stock", key: "openingStock", width: 17 },
    { header: "Warn at", key: "minStock", width: 10 },
    { header: "Expiry date", key: "expiryDate", width: 13 },
    { header: "Notes", key: "description", width: 26 },
  ];
  sheet.getRow(1).font = { bold: true };

  sheet.addRow({
    name: "Golden Penny Semovita 1kg",
    sku: "SEMO-1KG",
    barcode: "",
    category: "Foodstuff",
    supplier: "Mile 12 Market",
    unit: "pcs",
    packSize: "1kg",
    costPrice: 1150,
    sellingPrice: 1350,
    wholesalePrice: 1280,
    wholesaleMinQty: 12,
    openingStock: 24,
    minStock: 6,
    expiryDate: "",
    description: "",
  });
  sheet.addRow({
    name: "Peak Milk Powder 400g",
    sku: "PEAK-400",
    barcode: "6151100012345",
    category: "Beverages",
    supplier: "Mile 12 Market",
    unit: "carton",
    packSize: "12 x 400g",
    costPrice: 8200,
    sellingPrice: 9600,
    wholesalePrice: 9200,
    wholesaleMinQty: 6,
    openingStock: 8,
    minStock: 2,
    expiryDate: "2027-01-31",
    description: "Keep in a cool place.",
  });
  sheet.addRow({});

  const notes = wb.addWorksheet("How to use");
  notes.columns = [{ width: 100 }];
  notes.addRow(["One row per product, starting from row 2."]);
  notes.addRow(["Leave a column blank and we'll use the default — prices default to 0."]);
  notes.addRow(["Prices are plain numbers in naira. No ₦ sign, no commas."]);
  notes.addRow(["Dates go as YYYY-MM-DD, e.g. 2027-01-31."]);
  notes.addRow(["Category and Bought from are created automatically if they're new."]);
  notes.addRow(["Re-importing updates matching products but never changes their stock."]);
  for (let r = 1; r <= 6; r++) notes.getRow(r).font = { size: 11 };

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "product-import-template.xlsx";
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Kept so the schema stays the single source of truth about what a valid row is.
 * The client checks nothing itself here — the server validates every row and
 * reports failures by row number — but importing this proves at build time that
 * the module the client depends on is safe to reach from the browser.
 */
void ProductInputSchema;
