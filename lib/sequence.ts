import type { Prisma } from "@prisma/client";

import { prisma } from "./db";

/**
 * Human-readable sequential references.
 *
 * Shopkeepers and their customers quote these out loud on the phone
 * ("receipt IKJ-000148"), so they must be short, sequential and unambiguous —
 * a cuid is useless for that. They are display identifiers only; joins always
 * use the cuid primary key.
 */

/**
 * `CW-0001` for a landing-page plan request.
 *
 * Leads have no organization yet, so they can't use the org-scoped `Counter`
 * table. A count-and-retry is correct here: `Lead.reference` is unique, so the
 * worst case of two simultaneous submissions is one retry, and the real-world
 * arrival rate is a few per day.
 */
export async function nextLeadReference(): Promise<string> {
  const existing = await prisma.lead.count();
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = `CW-${String(existing + 1 + attempt).padStart(4, "0")}`;
    const clash = await prisma.lead.findUnique({
      where: { reference: candidate },
      select: { id: true },
    });
    if (!clash) return candidate;
  }
  // Pathological contention — fall back to something that cannot collide.
  return `CW-${Date.now().toString(36).toUpperCase()}`;
}

/**
 * Atomically take the next number for an org-scoped counter.
 *
 * MUST be called inside a transaction, and the caller must pass the
 * transaction client. The `upsert` + `increment` is a single statement, so two
 * concurrent tills cannot be handed the same receipt number: the second waits
 * on the row lock.
 *
 * Getting this wrong is not a cosmetic bug — duplicate receipt numbers break
 * the unique index on `Sale.receiptNo` and the sale fails at the till.
 */
export async function nextCounterValue(
  tx: Prisma.TransactionClient,
  organizationId: string,
  key: string,
): Promise<number> {
  const counter = await tx.counter.upsert({
    where: { organizationId_key: { organizationId, key } },
    create: { organizationId, key, value: 1 },
    update: { value: { increment: 1 } },
    select: { value: true },
  });
  return counter.value;
}

/**
 * `IKJ-000148` — branch code, then a zero-padded sequence.
 *
 * The branch prefix matters for multi-branch businesses: two tills in different
 * shops must never print the same receipt number, and a number you can read off
 * a receipt should tell you which shop issued it.
 */
export async function nextReceiptNumber(
  tx: Prisma.TransactionClient,
  organizationId: string,
  branchCode: string,
): Promise<string> {
  const value = await nextCounterValue(tx, organizationId, `receipt:${branchCode}`);
  return `${branchCode.toUpperCase()}-${String(value).padStart(6, "0")}`;
}

export async function nextPurchaseNumber(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<string> {
  const value = await nextCounterValue(tx, organizationId, "purchase");
  return `PO-${String(value).padStart(5, "0")}`;
}

/**
 * `RCT-000014` — our own ID for a filed supplier receipt. Six digits because a
 * busy supermarket files several a day, every day, for years.
 */
export async function nextSupplierReceiptNumber(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<string> {
  const value = await nextCounterValue(tx, organizationId, "supplier_receipt");
  return `RCT-${String(value).padStart(6, "0")}`;
}

export async function nextAdjustmentNumber(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<string> {
  const value = await nextCounterValue(tx, organizationId, "adjustment");
  return `ADJ-${String(value).padStart(5, "0")}`;
}

/**
 * URL-safe slug for an organization, guaranteed unique.
 * "Mama Nkechi Supermarket & Stores" -> "mama-nkechi-supermarket-stores"
 */
export async function uniqueOrgSlug(name: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 40)
      .replace(/^-|-$/g, "") || "shop";

  for (let attempt = 0; attempt < 30; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const clash = await prisma.organization.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!clash) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/**
 * Default SKU for a product typed in without one.
 * Not sequential on purpose — a shop that later imports a spreadsheet with its
 * own codes shouldn't find them fighting a sequence.
 */
export function generateSku(name: string): string {
  const letters =
    name
      .toUpperCase()
      .replace(/[^A-Z0-9 ]/g, "")
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => word.slice(0, 3))
      .join("")
      .slice(0, 6) || "ITEM";
  const suffix = Math.floor(Math.random() * 9000 + 1000);
  return `${letters}-${suffix}`;
}
