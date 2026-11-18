"use client";

import { useState } from "react";
import { Printer } from "lucide-react";

import { BarcodeLabel } from "@/components/Barcode";

/**
 * The print sheet.
 *
 * One client component for one reason: a person needs to say how many of each
 * label they want and then press Print. Everything else — the barcodes, the
 * prices — arrived fully formed from the server.
 *
 * The grid is marked `.print-root`; the global print stylesheet paints only
 * that back in and drops the app shell, so Ctrl-P gives a clean sheet of labels
 * with no sidebar, no toolbar, no page chrome. The toolbar here is `.no-print`
 * for the same reason.
 */
export interface LabelRow {
  id: string;
  name: string;
  /** What the scanner reads — the barcode if the product has one, else its SKU. */
  code: string;
  sku: string;
  /** Pre-formatted, e.g. "₦1,350". */
  price: string;
}

const MAX_COPIES = 50;

export function LabelSheet({ rows }: { rows: LabelRow[] }) {
  const [copies, setCopies] = useState(1);
  const [showPrice, setShowPrice] = useState(true);
  const [showSku, setShowSku] = useState(true);

  const perLabel = Math.min(Math.max(Math.trunc(copies) || 1, 1), MAX_COPIES);
  const total = rows.length * perLabel;

  // Flatten to one entry per physical label so the grid maps straight to paper.
  const labels = rows.flatMap((row) =>
    Array.from({ length: perLabel }, (_, i) => ({ row, key: `${row.id}-${i}` })),
  );

  return (
    <>
      {/* Toolbar — never printed. */}
      <div className="no-print card card-pad mb-4 flex flex-wrap items-end gap-x-5 gap-y-3">
        <div>
          <label htmlFor="copies" className="label">
            Copies of each
          </label>
          <input
            id="copies"
            type="number"
            min={1}
            max={MAX_COPIES}
            value={copies}
            onChange={(e) => setCopies(Number(e.target.value))}
            onBlur={() => setCopies(perLabel)}
            className="input w-24"
          />
        </div>

        <label className="flex cursor-pointer items-center gap-2 pb-2.5 text-sm font-medium text-ink-700">
          <input
            type="checkbox"
            checked={showPrice}
            onChange={(e) => setShowPrice(e.target.checked)}
            className="size-4 accent-brand-700"
          />
          Show price
        </label>

        <label className="flex cursor-pointer items-center gap-2 pb-2.5 text-sm font-medium text-ink-700">
          <input
            type="checkbox"
            checked={showSku}
            onChange={(e) => setShowSku(e.target.checked)}
            className="size-4 accent-brand-700"
          />
          Show stock code
        </label>

        <div className="ml-auto flex items-center gap-3 pb-1">
          <span className="text-sm text-ink-500">
            <span className="tabular font-semibold text-ink-900">
              {total.toLocaleString("en-NG")}
            </span>{" "}
            label{total === 1 ? "" : "s"}
          </span>
          <button type="button" className="btn btn-primary" onClick={() => window.print()}>
            <Printer className="size-4" />
            Print
          </button>
        </div>
      </div>

      {/* Screen preview panel. The grey tray is only for the screen — it's
          visibility:hidden in print, while the sheet inside lifts to the page
          origin, so none of this tints the paper. */}
      <div className="rounded-xl bg-ink-50 p-4">
        <div className="print-root flex flex-wrap content-start gap-2">
          {labels.map(({ row, key }) => (
            <BarcodeLabel
              key={key}
              name={row.name}
              code={row.code}
              price={showPrice ? row.price : undefined}
              // Don't repeat the code as a "stock code" line when the label's
              // barcode already is the SKU.
              sku={showSku && row.sku !== row.code ? row.sku : undefined}
            />
          ))}
        </div>
      </div>
    </>
  );
}
