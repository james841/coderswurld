import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { prisma } from "./db";

/**
 * Stock records for printing or sending: Excel, PDF and Word.
 *
 * One data builder, three renderers, so every format shows the same figures.
 * Quantities come from StockLevel (one branch, or all branches added up).
 * Values are at cost and at the retail price, in kobo until the renderer.
 */

export type ExportDepartment = "ALL" | "SUPERMARKET" | "PHARMACY";
export type ExportFormat = "xlsx" | "pdf" | "docx";

export interface StockExportRow {
  name: string;
  sku: string;
  barcode: string | null;
  category: string | null;
  unit: string;
  quantity: number;
  minStock: number;
  costKobo: number;
  priceKobo: number;
  costValueKobo: number;
  retailValueKobo: number;
  expiryDate: Date | null;
  status: "OK" | "LOW" | "OUT";
}

export type Totals = { items: number; units: number; costValueKobo: number; retailValueKobo: number; low: number; out: number };

/** One category inside a counter: "Provisions", "Pain relief", or "No category". */
export interface StockExportGroup {
  category: string;
  rows: StockExportRow[];
  totals: Totals;
}

/** One counter (or the whole shop when the shop doesn't split counters). */
export interface StockExportSection {
  title: string; // "Pharmacy", "Supermarket", or "All products"
  groups: StockExportGroup[];
  totals: Totals;
}

export interface StockExport {
  shopName: string;
  branchName: string; // "Ikeja Main" or "All branches"
  departmentLabel: string;
  /** Set when one category was asked for. */
  categoryLabel: string | null;
  generatedAt: Date;
  generatedBy: string;
  timezone: string;
  sections: StockExportSection[];
  grand: Totals;
}

const LABELS: Record<string, string> = { SUPERMARKET: "Supermarket", PHARMACY: "Pharmacy" };
const NO_CATEGORY = "No category";

export async function buildStockExport(opts: {
  organizationId: string;
  shopName: string;
  timezone: string;
  branch: { id: string; name: string } | null; // null = all branches
  department: ExportDepartment;
  departmentsEnabled: boolean;
  /** A category id, "none" for products with no category, or null for all. */
  categoryId: string | null;
  generatedBy: string;
  defaultLowStock: number;
}): Promise<StockExport> {
  const [products, category] = await Promise.all([
    prisma.product.findMany({
      where: {
        organizationId: opts.organizationId,
        isActive: true,
        ...(opts.department !== "ALL" ? { department: opts.department } : {}),
        ...(opts.categoryId === "none" ? { categoryId: null } : opts.categoryId ? { categoryId: opts.categoryId } : {}),
      },
      orderBy: { name: "asc" },
      select: {
        name: true,
        sku: true,
        barcode: true,
        unit: true,
        department: true,
        minStock: true,
        costPriceKobo: true,
        sellingPriceKobo: true,
        expiryDate: true,
        category: { select: { name: true, sortOrder: true } },
        stockLevels: {
          where: opts.branch ? { branchId: opts.branch.id } : {},
          select: { quantity: true },
        },
      },
    }),
    opts.categoryId && opts.categoryId !== "none"
      ? prisma.category.findFirst({ where: { id: opts.categoryId, organizationId: opts.organizationId }, select: { name: true } })
      : Promise.resolve(null),
  ]);

  const all = products.map((p) => {
    const quantity = p.stockLevels.reduce((t, l) => t + l.quantity, 0);
    const floor = p.minStock > 0 ? p.minStock : opts.defaultLowStock;
    const row: StockExportRow & { department: string; sortOrder: number } = {
      department: p.department,
      sortOrder: p.category?.sortOrder ?? 0,
      name: p.name,
      sku: p.sku,
      barcode: p.barcode,
      category: p.category?.name ?? null,
      unit: p.unit,
      quantity,
      minStock: p.minStock,
      costKobo: p.costPriceKobo,
      priceKobo: p.sellingPriceKobo,
      costValueKobo: Math.round(Math.max(0, quantity) * p.costPriceKobo),
      retailValueKobo: Math.round(Math.max(0, quantity) * p.sellingPriceKobo),
      expiryDate: p.expiryDate,
      status: quantity <= 0 ? "OUT" : quantity <= floor ? "LOW" : "OK",
    };
    return row;
  });

  const split = opts.departmentsEnabled && opts.department === "ALL";
  const counters: [string, typeof all][] = split
    ? (["SUPERMARKET", "PHARMACY"] as const)
        .map((d) => [LABELS[d], all.filter((r) => r.department === d)] as [string, typeof all])
        .filter(([, rows]) => rows.length > 0)
    : [[opts.department === "ALL" ? "All products" : LABELS[opts.department], all]];

  const sections: StockExportSection[] = counters.map(([title, rows]) => {
    // Group by category, in the shop's own category order, "No category" last.
    const byCat = new Map<string, typeof rows>();
    for (const r of rows) {
      const key = r.category ?? NO_CATEGORY;
      if (!byCat.has(key)) byCat.set(key, []);
      byCat.get(key)!.push(r);
    }
    const groups = [...byCat.entries()]
      .sort(([a, ra], [b, rb]) => {
        if (a === NO_CATEGORY) return 1;
        if (b === NO_CATEGORY) return -1;
        return ra[0].sortOrder - rb[0].sortOrder || a.localeCompare(b);
      })
      .map(([category, list]) => ({ category, rows: list, totals: totalsOf(list) }));
    return { title, groups, totals: totalsOf(rows) };
  });

  return {
    shopName: opts.shopName,
    branchName: opts.branch?.name ?? "All branches",
    departmentLabel:
      opts.department === "ALL" ? (opts.departmentsEnabled ? "Supermarket and pharmacy" : "All products") : LABELS[opts.department],
    categoryLabel: opts.categoryId === "none" ? NO_CATEGORY : (category?.name ?? null),
    generatedAt: new Date(),
    generatedBy: opts.generatedBy,
    timezone: opts.timezone,
    sections,
    grand: totalsOf(all),
  };
}

function totalsOf(rows: StockExportRow[]): Totals {
  return {
    items: rows.length,
    units: rows.reduce((t, r) => t + Math.max(0, r.quantity), 0),
    costValueKobo: rows.reduce((t, r) => t + r.costValueKobo, 0),
    retailValueKobo: rows.reduce((t, r) => t + r.retailValueKobo, 0),
    low: rows.filter((r) => r.status === "LOW").length,
    out: rows.filter((r) => r.status === "OUT").length,
  };
}

/** "Pharmacy, Pain relief" style subtitle used by every format. */
function scopeLine(data: StockExport) {
  return `Stock record: ${data.departmentLabel}${data.categoryLabel ? `, ${data.categoryLabel}` : ""}, ${data.branchName}`;
}
const summaryLine = (t: Totals) =>
  `${t.items} products, ${qty(t.units)} units, worth ${naira(t.costValueKobo)} at cost and ${naira(t.retailValueKobo)} at selling price. ${t.low} low, ${t.out} out of stock.`;

// ── shared formatting ───────────────────────────────────────────────────────

const naira = (kobo: number) =>
  "₦" + (kobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (n: number) => n.toLocaleString("en-NG", { maximumFractionDigits: 3 });
const STATUS_LABEL = { OK: "In stock", LOW: "Low", OUT: "Out of stock" } as const;

function stamp(d: Date, tz: string) {
  return new Intl.DateTimeFormat("en-NG", { timeZone: tz, dateStyle: "medium", timeStyle: "short" }).format(d);
}
function day(d: Date | null) {
  if (!d) return "";
  return new Intl.DateTimeFormat("en-NG", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" }).format(d);
}

export function exportFileName(data: StockExport, format: ExportFormat) {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: data.timezone }).format(data.generatedAt);
  const scope = [data.departmentLabel, data.categoryLabel].filter(Boolean).map((x) => slug(x!)).join("-");
  return `stock-${slug(data.shopName)}-${scope}-${date}.${format}`;
}

// ── Excel ───────────────────────────────────────────────────────────────────

export async function renderXlsx(data: StockExport): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Coderswurld Inventory";
  wb.created = data.generatedAt;
  const money = '"₦"#,##0.00';
  const NAVY = "FF1D3A8A";
  const solid = (argb: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } });

  // Sheet 1: every product, grouped by counter then category. This is the
  // sheet Excel opens on, so the products are the first thing anyone sees.
  const ws = wb.addWorksheet("Stock record", {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
    headerFooter: { oddFooter: "&LCoderswurld Inventory&RPage &P of &N" },
  });
  ws.columns = [
    { width: 5 }, { width: 34 }, { width: 14 }, { width: 16 }, { width: 8 }, { width: 10 },
    { width: 10 }, { width: 13 }, { width: 13 }, { width: 15 }, { width: 15 }, { width: 13 }, { width: 13 },
  ];
  const HEAD = ["#", "Product", "SKU", "Barcode", "Unit", "On hand", "Reorder at", "Cost price", "Selling price", "Value at cost", "Value at price", "Nearest expiry", "Status"];
  const LAST = HEAD.length;
  ws.addRow([data.shopName]).font = { bold: true, size: 16 };
  ws.addRow([scopeLine(data)]).font = { size: 12 };
  ws.addRow([`Printed ${stamp(data.generatedAt, data.timezone)} by ${data.generatedBy}`]).font = { color: { argb: "FF6A6A6A" } };
  ws.addRow([]);
  const head = ws.addRow(HEAD);
  head.eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = solid(NAVY);
    c.alignment = { vertical: "middle", wrapText: true };
  });
  head.height = 22;

  const band = (text: string, fill: string, color: string, size: number) => {
    const r = ws.addRow([text]);
    ws.mergeCells(r.number, 1, r.number, LAST);
    r.getCell(1).font = { bold: true, size, color: { argb: color } };
    r.getCell(1).fill = solid(fill);
    r.height = size + 9;
  };
  const totalRow = (label: string, t: Totals, strong: boolean) => {
    const r = ws.addRow(["", label, "", "", "", t.units, "", "", "", t.costValueKobo / 100, t.retailValueKobo / 100, "", `${t.low} low, ${t.out} out`]);
    r.font = { bold: true, size: strong ? 11 : 10 };
    [10, 11].forEach((c) => (r.getCell(c).numFmt = money));
    r.eachCell((c) => (c.border = { top: { style: strong ? "medium" : "thin", color: { argb: NAVY } } }));
  };

  for (const sec of data.sections) {
    if (data.sections.length > 1 || sec.title !== "All products") band(sec.title.toUpperCase(), NAVY, "FFFFFFFF", 12);
    let n = 0;
    for (const g of sec.groups) {
      band(g.category, "FFE8EDF8", NAVY, 11);
      g.rows.forEach((r, i) => {
        n++;
        const row = ws.addRow([
          n, r.name, r.sku, r.barcode ?? "", r.unit, r.quantity, r.minStock,
          r.costKobo / 100, r.priceKobo / 100, r.costValueKobo / 100, r.retailValueKobo / 100,
          r.expiryDate ?? "", STATUS_LABEL[r.status],
        ]);
        [8, 9, 10, 11].forEach((c) => (row.getCell(c).numFmt = money));
        row.getCell(12).numFmt = "dd mmm yyyy";
        if (r.status !== "OK") row.getCell(13).font = { bold: true, color: { argb: r.status === "OUT" ? "FFB91C1C" : "FFB45309" } };
        if (i % 2 === 1) row.eachCell((c) => (c.fill = solid("FFF7F8FC")));
      });
      totalRow(`${g.category} total`, g.totals, false);
    }
    totalRow(`${sec.title} total`, sec.totals, true);
    ws.addRow([]);
  }
  if (data.sections.length > 1) totalRow("Grand total", data.grand, true);
  ws.views = [{ state: "frozen", ySplit: head.number }];
  ws.pageSetup.printTitlesRow = `${head.number}:${head.number}`;

  // Sheet 2: one line per counter and category, for a quick look.
  const s = wb.addWorksheet("Summary by category");
  s.columns = [{ width: 18 }, { width: 28 }, { width: 11 }, { width: 11 }, { width: 18 }, { width: 20 }, { width: 8 }, { width: 13 }];
  s.addRow([data.shopName]).font = { bold: true, size: 16 };
  s.addRow([`Summary by category, ${data.branchName}`]);
  s.addRow([]);
  const sh = s.addRow(["Counter", "Category", "Products", "Units", "Value at cost", "Value at selling price", "Low", "Out of stock"]);
  sh.eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = solid(NAVY);
  });
  const line = (a: string, b: string, t: Totals, bold = false) => {
    const r = s.addRow([a, b, t.items, t.units, t.costValueKobo / 100, t.retailValueKobo / 100, t.low, t.out]);
    r.getCell(5).numFmt = money;
    r.getCell(6).numFmt = money;
    if (bold) r.font = { bold: true };
  };
  for (const sec of data.sections) {
    for (const g of sec.groups) line(sec.title, g.category, g.totals);
    line(sec.title, "All categories", sec.totals, true);
  }
  if (data.sections.length > 1) line("Whole shop", "", data.grand, true);

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ── PDF ─────────────────────────────────────────────────────────────────────

async function fonts() {
  const dir = path.join(process.cwd(), "assets", "fonts");
  const [regular, bold] = await Promise.all([
    readFile(path.join(dir, "DejaVuSansCondensed.ttf")),
    readFile(path.join(dir, "DejaVuSansCondensed-Bold.ttf")),
  ]);
  return { regular, bold };
}

export async function renderPdf(data: StockExport): Promise<Buffer> {
  const PDFDocument = (await import("pdfkit")).default;
  const { regular, bold } = await fonts();
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 32, bufferPages: true, info: { Title: `${data.shopName} stock record`, Author: "Coderswurld Inventory" } });
  doc.registerFont("R", regular);
  doc.registerFont("B", bold);
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const NAVY = "#1d3a8a";
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom - 24;

  // Column plan (widths add up to the printable width).
  const cols = [
    { h: "#", w: 24, a: "right" },
    { h: "Product", w: 150, a: "left" },
    { h: "SKU", w: 80, a: "left" },
    { h: "Unit", w: 54, a: "left" },
    { h: "On hand", w: 52, a: "right" },
    { h: "Reorder", w: 44, a: "right" },
    { h: "Cost", w: 58, a: "right" },
    { h: "Price", w: 58, a: "right" },
    { h: "Value (cost)", w: 70, a: "right" },
    { h: "Value (price)", w: 70, a: "right" },
    { h: "Expiry", w: 58, a: "left" },
    { h: "Status", w: 0, a: "left" },
  ] as const;
  const used = cols.reduce((t, c) => t + c.w, 0);
  const widths = cols.map((c) => (c.w === 0 ? width - used : c.w));

  function header() {
    doc.font("B").fontSize(16).fillColor("#0a0a0a").text(data.shopName, left, 32);
    doc.font("R").fontSize(10).fillColor("#444").text(scopeLine(data));
    doc.fontSize(8.5).fillColor("#6a6a6a").text(`Printed ${stamp(data.generatedAt, data.timezone)} by ${data.generatedBy}`);
    doc.moveDown(0.6);
  }

  function tableHead() {
    const y = doc.y;
    doc.rect(left, y, width, 18).fill(NAVY);
    let x = left;
    doc.font("B").fontSize(7.5).fillColor("#fff");
    cols.forEach((c, i) => {
      doc.text(c.h, x + 3, y + 5, { width: widths[i] - 6, align: c.a, lineBreak: false });
      x += widths[i];
    });
    doc.y = y + 18;
  }

  function row(cells: string[], opts: { bold?: boolean; shade?: boolean; statusColor?: string } = {}) {
    doc.font(opts.bold ? "B" : "R").fontSize(7.5);
    const h = Math.max(14, doc.heightOfString(cells[1], { width: widths[1] - 6 }) + 6);
    if (doc.y + h > bottom()) {
      doc.addPage();
      doc.y = doc.page.margins.top;
      tableHead();
      doc.font(opts.bold ? "B" : "R").fontSize(7.5);
    }
    const y = doc.y;
    if (opts.shade) doc.rect(left, y, width, h).fill("#f4f6fb");
    let x = left;
    cells.forEach((text, i) => {
      doc.fillColor(i === cells.length - 1 && opts.statusColor ? opts.statusColor : "#111");
      doc.font(opts.bold || (i === cells.length - 1 && opts.statusColor) ? "B" : "R");
      doc.text(text, x + 3, y + 3, { width: widths[i] - 6, align: cols[i].a, lineBreak: i === 1 });
      x += widths[i];
    });
    doc.y = y + h;
  }

  function band(text: string) {
    if (doc.y + 34 > bottom()) {
      doc.addPage();
      doc.y = doc.page.margins.top;
      tableHead();
    }
    const y = doc.y;
    doc.rect(left, y, width, 16).fill("#e8edf8");
    doc.font("B").fontSize(8.5).fillColor(NAVY).text(text, left + 6, y + 4, { width: width - 12, lineBreak: false });
    doc.y = y + 16;
  }

  header();
  data.sections.forEach((sec, si) => {
    if (si > 0) {
      if (doc.y + 80 > bottom()) {
        doc.addPage();
        doc.y = doc.page.margins.top;
      } else doc.moveDown(1);
    }
    doc.font("B").fontSize(12).fillColor(NAVY).text(sec.title, left, doc.y);
    doc.font("R").fontSize(8.5).fillColor("#555").text(summaryLine(sec.totals));
    doc.moveDown(0.4);
    tableHead();
    let n = 0;
    for (const g of sec.groups) {
      band(`${g.category}  (${g.totals.items} ${g.totals.items === 1 ? "product" : "products"})`);
      g.rows.forEach((r, i) => {
        n++;
        row(
          [String(n), r.name, r.sku, r.unit, qty(r.quantity), qty(r.minStock), naira(r.costKobo), naira(r.priceKobo),
            naira(r.costValueKobo), naira(r.retailValueKobo), day(r.expiryDate), STATUS_LABEL[r.status]],
          { shade: i % 2 === 1, statusColor: r.status === "OUT" ? "#b91c1c" : r.status === "LOW" ? "#b45309" : undefined },
        );
      });
      row(["", `${g.category} total`, "", "", qty(g.totals.units), "", "", "", naira(g.totals.costValueKobo), naira(g.totals.retailValueKobo), "", ""], { bold: true });
    }
    row(["", `${sec.title} total`, "", "", qty(sec.totals.units), "", "", "", naira(sec.totals.costValueKobo), naira(sec.totals.retailValueKobo), "", ""], { bold: true });
  });

  if (data.sections.length > 1) {
    doc.moveDown(0.8);
    doc.font("B").fontSize(10).fillColor("#0a0a0a")
      .text(`Grand total: ${data.grand.items} products, ${naira(data.grand.costValueKobo)} at cost, ${naira(data.grand.retailValueKobo)} at selling price.`, left);
  }

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    // Writing below the bottom margin would make pdfkit start a new page.
    doc.page.margins.bottom = 0;
    doc.font("R").fontSize(7.5).fillColor("#888")
      .text(`Coderswurld Inventory`, left, doc.page.height - 26, { lineBreak: false })
      .text(`Page ${i + 1} of ${range.count}`, left, doc.page.height - 26, { width, align: "right", lineBreak: false });
  }
  doc.end();
  return done;
}

// ── Word ────────────────────────────────────────────────────────────────────

export async function renderDocx(data: StockExport): Promise<Buffer> {
  const d = await import("docx");
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, PageOrientation, ShadingType, Footer, PageNumber, BorderStyle } = d;
  const NAVY = "1D3A8A";
  const size = 15; // 7.5pt, half-points

  const cell = (text: string, o: { bold?: boolean; head?: boolean; right?: boolean; shade?: string; color?: string } = {}) =>
    new TableCell({
      shading: o.head ? { type: ShadingType.CLEAR, fill: NAVY, color: "auto" } : o.shade ? { type: ShadingType.CLEAR, fill: o.shade, color: "auto" } : undefined,
      margins: { top: 40, bottom: 40, left: 60, right: 60 },
      children: [
        new Paragraph({
          alignment: o.right ? AlignmentType.RIGHT : AlignmentType.LEFT,
          children: [new TextRun({ text, bold: o.bold || o.head, size, color: o.head ? "FFFFFF" : o.color, font: "Calibri" })],
        }),
      ],
    });

  const HEAD = ["#", "Product", "SKU", "Unit", "On hand", "Reorder", "Cost", "Price", "Value (cost)", "Value (price)", "Expiry", "Status"];
  const RIGHT = new Set([0, 4, 5, 6, 7, 8, 9]);
  const colW = [3, 21, 11, 9, 7, 5, 8, 8, 9, 9, 9, 8]; // percent

  const children: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [
    new Paragraph({ children: [new TextRun({ text: data.shopName, bold: true, size: 32, font: "Calibri" })] }),
    new Paragraph({ children: [new TextRun({ text: scopeLine(data), size: 22, font: "Calibri" })] }),
    new Paragraph({
      spacing: { after: 200 },
      children: [new TextRun({ text: `Printed ${stamp(data.generatedAt, data.timezone)} by ${data.generatedBy}`, size: 18, color: "6A6A6A", font: "Calibri" })],
    }),
  ];

  for (const sec of data.sections) {
    children.push(
      new Paragraph({ spacing: { before: 240 }, children: [new TextRun({ text: sec.title, bold: true, size: 26, color: NAVY, font: "Calibri" })] }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun({
          text: summaryLine(sec.totals),
          size: 18, color: "555555", font: "Calibri",
        })],
      }),
    );
    const bandRow = (text: string) =>
      new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            columnSpan: HEAD.length,
            shading: { type: ShadingType.CLEAR, fill: "E8EDF8", color: "auto" },
            margins: { top: 50, bottom: 50, left: 80, right: 80 },
            children: [new Paragraph({ children: [new TextRun({ text, bold: true, size: 17, color: NAVY, font: "Calibri" })] })],
          }),
        ],
      });
    const totalCells = (label: string, t: { units: number; costValueKobo: number; retailValueKobo: number }) =>
      new TableRow({
        children: ["", label, "", "", qty(t.units), "", "", "", naira(t.costValueKobo), naira(t.retailValueKobo), "", ""].map((x, c) =>
          cell(x, { bold: true, right: RIGHT.has(c) }),
        ),
      });
    let n = 0;
    const rows = [
      new TableRow({ tableHeader: true, children: HEAD.map((h, i) => cell(h, { head: true, right: RIGHT.has(i) })) }),
      ...sec.groups.flatMap((g) => [
        bandRow(`${g.category}  (${g.totals.items} ${g.totals.items === 1 ? "product" : "products"})`),
        ...g.rows.map((r, i) => {
          n++;
          return new TableRow({
            cantSplit: true,
            children: [String(n), r.name, r.sku, r.unit, qty(r.quantity), qty(r.minStock), naira(r.costKobo), naira(r.priceKobo),
              naira(r.costValueKobo), naira(r.retailValueKobo), day(r.expiryDate), STATUS_LABEL[r.status]].map((t, c) =>
              cell(t, {
                right: RIGHT.has(c),
                shade: i % 2 === 1 ? "F7F8FC" : undefined,
                bold: c === 11 && r.status !== "OK",
                color: c === 11 ? (r.status === "OUT" ? "B91C1C" : r.status === "LOW" ? "B45309" : undefined) : undefined,
              }),
            ),
          });
        }),
        totalCells(`${g.category} total`, g.totals),
      ]),
      totalCells(`${sec.title} total`, sec.totals),
    ];
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        columnWidths: colW.map((p) => Math.round((p / 100) * 15398)),
        borders: {
          top: { style: BorderStyle.SINGLE, size: 4, color: "D9DEE8" },
          bottom: { style: BorderStyle.SINGLE, size: 4, color: "D9DEE8" },
          left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
          right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
          insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: "E5E8EF" },
          insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        },
        rows,
      }),
    );
  }

  if (data.sections.length > 1) {
    children.push(
      new Paragraph({
        spacing: { before: 240 },
        children: [new TextRun({
          text: `Grand total: ${data.grand.items} products, ${naira(data.grand.costValueKobo)} at cost, ${naira(data.grand.retailValueKobo)} at selling price.`,
          bold: true, size: 20, font: "Calibri",
        })],
      }),
    );
  }

  const doc = new Document({
    creator: "Coderswurld Inventory",
    title: `${data.shopName} stock record`,
    sections: [
      {
        properties: {
          page: {
            // docx swaps these itself for landscape: give the portrait A4 size.
            size: { orientation: PageOrientation.LANDSCAPE, width: 11906, height: 16838 },
            margin: { top: 720, bottom: 720, left: 720, right: 720 },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({ text: "Coderswurld Inventory    Page ", size: 15, color: "888888" }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 15, color: "888888" }),
                  new TextRun({ text: " of ", size: 15, color: "888888" }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 15, color: "888888" }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}
