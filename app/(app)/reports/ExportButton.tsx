"use client";

import { useRef, useState } from "react";
import { Check, Download } from "lucide-react";

/**
 * Export the on-screen report as a spreadsheet.
 *
 * WHY A HAND-ROLLED CSV AND NOT A LIBRARY
 * ---------------------------------------
 * The numbers are already on the page — the server shipped them to render the
 * tables. Rebuilding them into CSV in the browser means the download is instant
 * and costs the shop nothing: no second query, no extra egress on a metered
 * connection, no server round trip. A shop owner on a phone tether feels that.
 *
 * WHY THE VALUES ARE BARE NUMBERS
 * -------------------------------
 * Every money figure arrives here already in naira (the server divided the kobo
 * out), and we write it with no ₦ and no thousands commas. That is deliberate:
 * Excel and Google Sheets read "482000" as a number you can sum, but "₦482,000"
 * as text you cannot. The report is meant to be totalled and charted, so the
 * cells have to stay numeric.
 */

export interface ReportExport {
  orgName: string;
  rangeKey: string;
  rangeLabel: string;
  /** "YYYY-MM-DD" the file was generated — part of the filename. */
  generatedKey: string;
  /** Whether profit columns were included (gated upstream by reports.profit). */
  includeProfit: boolean;
  summary: Array<[string, number]>;
  byDay: Array<{ day: string; revenue: number; sales: number }>;
  byCashier: Array<{ name: string; sales: number; taken: number; profit: number | null }>;
  topProducts: Array<{ name: string; qty: number; amount: number }>;
  byMethod: Array<{ method: string; amount: number; count: number }>;
}

export function ExportButton({ data }: { data: ReportExport }) {
  const [done, setDone] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleExport() {
    const csv = buildCsv(data);
    // A leading BOM so Excel on Windows opens it as UTF-8 — otherwise a product
    // name with an accent or a native-language character arrives mojibake.
    const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reports-${data.rangeKey}-${data.generatedKey}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    setDone(true);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setDone(false), 2000);
  }

  return (
    <button type="button" onClick={handleExport} className="btn btn-outline btn-sm">
      {done ? <Check className="size-4 text-good-700" /> : <Download className="size-4" />}
      {done ? "Downloaded" : "Export CSV"}
    </button>
  );
}

/**
 * Build the whole workbook as one CSV string. Sections are separated by a blank
 * row — a shape every spreadsheet tool reads cleanly, and a human can scan in a
 * text editor too.
 */
function buildCsv(data: ReportExport): string {
  const rows: string[][] = [];

  rows.push([data.orgName]);
  rows.push(["Sales report", data.rangeLabel]);
  rows.push(["Generated", data.generatedKey]);
  rows.push([]);

  rows.push(["Summary"]);
  for (const [label, value] of data.summary) rows.push([label, num(value)]);

  if (data.byDay.length > 0) {
    rows.push([]);
    rows.push(["Daily takings"]);
    rows.push(["Date", "Takings", "Sales"]);
    for (const d of data.byDay) rows.push([d.day, num(d.revenue), num(d.sales)]);
  }

  if (data.byCashier.length > 0) {
    rows.push([]);
    rows.push(["By cashier"]);
    const header = ["Cashier", "Sales", "Taken"];
    if (data.includeProfit) header.push("Profit");
    rows.push(header);
    for (const c of data.byCashier) {
      const row = [c.name, num(c.sales), num(c.taken)];
      if (data.includeProfit) row.push(c.profit === null ? "" : num(c.profit));
      rows.push(row);
    }
  }

  if (data.topProducts.length > 0) {
    rows.push([]);
    rows.push(["Best sellers"]);
    rows.push(["Product", "Quantity", "Amount"]);
    for (const p of data.topProducts) rows.push([p.name, num(p.qty), num(p.amount)]);
  }

  if (data.byMethod.length > 0) {
    rows.push([]);
    rows.push(["Payment methods"]);
    rows.push(["Method", "Amount", "Sales"]);
    for (const m of data.byMethod) rows.push([m.method, num(m.amount), num(m.count)]);
  }

  // RFC 4180 line endings — what Excel expects.
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function num(value: number): string {
  return Number.isFinite(value) ? String(value) : "";
}

/**
 * Make one value safe to drop into a CSV cell.
 *
 * Two jobs: quote anything containing a comma, quote, or newline (so the shape
 * survives), and neutralise spreadsheet formula injection — a product named
 * "=cmd|…" should never execute when the owner opens the file. The injection
 * guard deliberately skips anything that is a plain number, so a negative net
 * like "-5000" stays a number rather than being quoted into text.
 */
function csvCell(value: string): string {
  let v = value;
  if (/^[=+\-@\t\r]/.test(v) && !/^-?\d+(\.\d+)?$/.test(v)) {
    v = `'${v}`;
  }
  if (/[",\r\n]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}
