import "server-only";

import type { Prisma } from "@prisma/client";

import { prisma } from "./db";

/**
 * Supplier receipts — the shared query behind both the page's first paint and
 * the search API, so the two can never disagree about what "search" means.
 */

export const RECEIPT_PAGE_SIZE = 24;

/** Upload limits. The browser compresses first; these are the server's backstop. */
export const MAX_IMAGE_BYTES = 1_500_000; // a compressed photo is ~100-300 KB
export const MAX_PDF_BYTES = 5_000_000;
export const MAX_THUMB_BYTES = 120_000;

export interface ReceiptRow {
  id: string;
  reference: string;
  receiptNo: string | null;
  receiptDate: string;
  amountKobo: number | null;
  note: string | null;
  supplierId: string | null;
  supplierName: string;
  purchaseId: string | null;
  purchaseReference: string | null;
  fileMime: string;
  fileBytes: number;
  originalBytes: number;
  hasThumb: boolean;
  uploadedByName: string | null;
  createdAt: string;
}

export interface ReceiptQuery {
  organizationId: string;
  q?: string | null;
  supplierId?: string | null;
  /** Exact supplier name (any letter case), from the filter. */
  supplier?: string | null;
  from?: Date | null;
  to?: Date | null;
  /** Id of the last row already shown — "load more" continues after it. */
  cursor?: string | null;
}

const SELECT = {
  id: true,
  reference: true,
  receiptNo: true,
  receiptDate: true,
  amountKobo: true,
  note: true,
  supplierId: true,
  supplierName: true,
  purchaseId: true,
  purchase: { select: { reference: true } },
  fileMime: true,
  fileBytes: true,
  originalBytes: true,
  thumbKey: true,
  uploadedByName: true,
  createdAt: true,
} satisfies Prisma.SupplierReceiptSelect;

type Selected = Prisma.SupplierReceiptGetPayload<{ select: typeof SELECT }>;

export function toReceiptRow(r: Selected): ReceiptRow {
  return {
    id: r.id,
    reference: r.reference,
    receiptNo: r.receiptNo,
    receiptDate: r.receiptDate.toISOString(),
    amountKobo: r.amountKobo,
    note: r.note,
    supplierId: r.supplierId,
    supplierName: r.supplierName,
    purchaseId: r.purchaseId,
    purchaseReference: r.purchase?.reference ?? null,
    fileMime: r.fileMime,
    fileBytes: r.fileBytes,
    originalBytes: r.originalBytes,
    hasThumb: r.thumbKey !== null,
    uploadedByName: r.uploadedByName,
    createdAt: r.createdAt.toISOString(),
  };
}

/**
 * One search box, every way a person remembers a piece of paper: the supplier's
 * name, our ID (RCT-000014), the number printed on it, the purchase it belongs
 * to, or a word from the note.
 *
 * Every branch of the OR is already inside `organizationId`, which leads every
 * index on this table — so this is a scan of one shop's receipts, never of the
 * whole platform's.
 */
function buildWhere(query: ReceiptQuery): Prisma.SupplierReceiptWhereInput {
  const q = query.q?.trim();
  const where: Prisma.SupplierReceiptWhereInput = {
    organizationId: query.organizationId,
  };
  if (query.supplierId) where.supplierId = query.supplierId;
  if (query.supplier?.trim()) where.supplierName = { equals: query.supplier.trim(), mode: "insensitive" };
  if (query.from || query.to) {
    where.receiptDate = {
      ...(query.from ? { gte: query.from } : {}),
      ...(query.to ? { lt: query.to } : {}),
    };
  }
  if (q) {
    where.OR = [
      { supplierName: { contains: q, mode: "insensitive" } },
      { reference: { contains: q, mode: "insensitive" } },
      { receiptNo: { contains: q, mode: "insensitive" } },
      { note: { contains: q, mode: "insensitive" } },
      { purchase: { reference: { contains: q, mode: "insensitive" } } },
    ];
  }
  return where;
}

export async function listReceipts(
  query: ReceiptQuery,
): Promise<{ items: ReceiptRow[]; nextCursor: string | null; total: number }> {
  const where = buildWhere(query);

  const [rows, total] = await Promise.all([
    prisma.supplierReceipt.findMany({
      where,
      // Newest paper first; `id` breaks ties so paging is stable when several
      // receipts share a date.
      orderBy: [{ receiptDate: "desc" }, { id: "desc" }],
      take: RECEIPT_PAGE_SIZE + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: SELECT,
    }),
    prisma.supplierReceipt.count({ where }),
  ]);

  const hasMore = rows.length > RECEIPT_PAGE_SIZE;
  const page = hasMore ? rows.slice(0, RECEIPT_PAGE_SIZE) : rows;
  return {
    items: page.map(toReceiptRow),
    nextCursor: hasMore ? page[page.length - 1].id : null,
    total,
  };
}

export async function getReceiptRow(
  organizationId: string,
  id: string,
): Promise<ReceiptRow | null> {
  const row = await prisma.supplierReceipt.findFirst({
    where: { id, organizationId },
    select: SELECT,
  });
  return row ? toReceiptRow(row) : null;
}

/**
 * What the bytes really are, read from the file itself.
 *
 * The browser's `file.type` is a claim, not a fact — it is derived from the file
 * extension. A file is only stored if its first bytes say it is one of the four
 * formats below, and it is later served back with that detected type and
 * `nosniff`, so nothing uploaded here can ever be run as a web page.
 */
export function sniffFileType(
  bytes: Uint8Array,
): { mime: string; ext: string; kind: "image" | "pdf" } | null {
  const b = bytes;
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return { mime: "image/jpeg", ext: "jpg", kind: "image" };
  }
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { mime: "image/png", ext: "png", kind: "image" };
  }
  // "RIFF" …. "WEBP"
  if (
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return { mime: "image/webp", ext: "webp", kind: "image" };
  }
  // "%PDF-"
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) {
    return { mime: "application/pdf", ext: "pdf", kind: "pdf" };
  }
  return null;
}

/**
 * Turn a typed supplier name into what a receipt stores. A name that matches a
 * saved supplier (ignoring letter case and extra spaces) is linked to it and
 * takes its spelling; any other name is kept exactly as typed.
 */
export async function resolveSupplierName(
  organizationId: string,
  typed: string,
): Promise<{ supplierId: string | null; supplierName: string }> {
  const name = typed.trim().replace(/\s+/g, " ");
  const match = await prisma.supplier.findFirst({
    where: { organizationId, name: { equals: name, mode: "insensitive" } },
    select: { id: true, name: true },
  });
  return match ? { supplierId: match.id, supplierName: match.name } : { supplierId: null, supplierName: name };
}

/** Names to suggest while typing: saved suppliers plus names already used on receipts. */
export async function supplierNameSuggestions(organizationId: string): Promise<string[]> {
  const [saved, used] = await Promise.all([
    prisma.supplier.findMany({ where: { organizationId, isActive: true }, select: { name: true } }),
    prisma.supplierReceipt.findMany({
      where: { organizationId },
      distinct: ["supplierName"],
      select: { supplierName: true },
      take: 500,
    }),
  ]);
  const seen = new Map<string, string>();
  for (const n of [...saved.map((s) => s.name), ...used.map((u) => u.supplierName)]) {
    const key = n.trim().toLowerCase();
    if (key && !seen.has(key)) seen.set(key, n.trim());
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}
