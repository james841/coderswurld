import { bumpCatalogVersion } from "./catalog";
import type { Prisma } from "@prisma/client";

import { prisma } from "./db";

/**
 * The stock ledger.
 *
 * WHY A LEDGER AND A CACHE
 * ------------------------
 * `StockMovement` is append-only truth: every unit that ever entered or left the
 * shop is a row, and the reason is recorded with it. That is what answers "why is
 * stock 136?" three months later, and it is what an auditor of any kind wants to
 * see.
 *
 * But summing a ledger to render a product list is O(history) per page view, and
 * the POS must not do that. So `StockLevel` carries the running quantity and is
 * updated inside the same transaction as the movement that changed it. The ledger
 * is the record; the level is the cache. If they ever disagree, the ledger wins
 * and the level gets rebuilt — see `recountProduct`.
 *
 * WHY THIS FILE EXISTS AT ALL
 * ---------------------------
 * Four modules move stock: products (opening quantity), purchases (goods
 * received), the POS (sales), and adjustments (damage, recounts, transfers).
 * Each of them writing its own upsert is how a codebase ends up with four
 * slightly different notions of what happens when quantity goes negative.
 */

export class StockError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "StockError";
  }
}

export interface MovementInput {
  organizationId: string;
  branchId: string;
  productId: string;
  /**
   * Signed delta: `+50` received, `-3` sold. Always the caller's actual change,
   * never a target — `RECOUNT` is the one exception, handled by `applyRecount`.
   */
  quantity: number;
  type: string;
  unitCostKobo?: number;
  referenceType?: string | null;
  referenceId?: string | null;
  reason?: string | null;
  userId?: string | null;
  /**
   * Stock arriving: its batch number and expiry. When either is set a new
   * batch is opened, so it can later be sold oldest-expiry first.
   */
  batch?: { batchNo?: string | null; expiryDate?: Date | null; source?: string } | null;
  /** Stock leaving: take it from this batch only (writing off one batch). */
  fromBatchId?: string | null;
}

/**
 * Apply one stock change, inside a transaction the caller already opened.
 *
 * The caller MUST pass a transaction client. Opening one here would be wrong:
 * a purchase creates the purchase row, its items, the movements and the supplier
 * balance, and half of that landing is worse than none of it.
 *
 * Returns the new balance so the caller can put it on a receipt or a movement row.
 */
export async function applyMovement(
  tx: Prisma.TransactionClient,
  movement: MovementInput,
  options: {
    allowNegative?: boolean;
    /** Called when stock leaving had to come from an already-expired batch. */
    onExpiredTaken?: (quantity: number) => void;
  } = {},
): Promise<number> {
  if (!Number.isFinite(movement.quantity) || movement.quantity === 0) {
    /*
     * A zero movement is not harmless: it writes a row that says nothing
     * happened, and it makes a manager scrolling the ledger wonder what they
     * are looking at. Refuse it loudly during development instead.
     */
    throw new StockError("A stock movement must change the quantity.");
  }

  // Upsert first so every product has a level row, then adjust. Two statements
  // rather than one `increment` on the upsert because the guard below needs the
  // resulting figure, and `updateMany` with a floor cannot return it.
  const existing = await tx.stockLevel.findUnique({
    where: { productId_branchId: { productId: movement.productId, branchId: movement.branchId } },
    select: { id: true, quantity: true },
  });

  const current = existing?.quantity ?? 0;
  const next = current + movement.quantity;

  if (next < 0 && !options.allowNegative) {
    /*
     * The message names the shortfall in units, not in rows. A cashier reading
     * "cannot sell 4 more than the 6 on hand" knows exactly what to do; a
     * message about a missing StockLevel row tells them to call somebody.
     */
    throw new StockError(
      `Not enough stock: this would leave ${Math.abs(next)} below zero. ` +
        `Only ${current} on hand.`,
    );
  }

  if (existing) {
    await tx.stockLevel.update({
      where: { id: existing.id },
      data: {
        quantity: next,
        lastMovementAt: new Date(),
        ...(movement.type === "RECOUNT" ? { lastCountedAt: new Date() } : {}),
      },
    });
  } else {
    await tx.stockLevel.create({
      data: {
        organizationId: movement.organizationId,
        productId: movement.productId,
        branchId: movement.branchId,
        quantity: next,
        lastMovementAt: new Date(),
        ...(movement.type === "RECOUNT" ? { lastCountedAt: new Date() } : {}),
      },
    });
  }

  await tx.stockMovement.create({
    data: {
      organizationId: movement.organizationId,
      branchId: movement.branchId,
      productId: movement.productId,
      type: movement.type,
      quantity: movement.quantity,
      // Running balance on the row itself: a ledger you can read top to bottom
      // without re-adding the column above it.
      balanceAfter: next,
      unitCostKobo: movement.unitCostKobo ?? 0,
      referenceType: movement.referenceType ?? null,
      referenceId: movement.referenceId ?? null,
      reason: movement.reason ?? null,
      userId: movement.userId ?? null,
    },
  });

  await syncBatches(tx, movement, options.onExpiredTaken);

  return next;
}

/** Midnight today, UTC: a batch expiring today still counts as good today. */
function startOfToday() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Keep batches in step with a movement, then refresh the product's nearest
 * expiry. Products that have never had a batch are skipped after one cheap
 * query, so shops that don't track expiry pay almost nothing for this.
 */
async function syncBatches(
  tx: Prisma.TransactionClient,
  m: MovementInput,
  onExpiredTaken?: (quantity: number) => void,
) {
  const wantsBatch = m.quantity > 0 && Boolean(m.batch && (m.batch.batchNo || m.batch.expiryDate));

  if (wantsBatch) {
    await tx.stockBatch.create({
      data: {
        organizationId: m.organizationId,
        productId: m.productId,
        branchId: m.branchId,
        batchNo: m.batch?.batchNo ?? null,
        expiryDate: m.batch?.expiryDate ?? null,
        quantityReceived: m.quantity,
        quantityLeft: m.quantity,
        unitCostKobo: m.unitCostKobo ?? 0,
        source: m.batch?.source ?? (m.type === "PURCHASE" ? "PURCHASE" : m.type === "OPENING" ? "OPENING" : "ADJUSTMENT"),
        referenceId: m.referenceId ?? null,
      },
    });
  } else {
    const batches = await tx.stockBatch.findMany({
      where: { productId: m.productId, branchId: m.branchId, writtenOffAt: null },
      select: { id: true, expiryDate: true, quantityLeft: true, receivedAt: true },
    });
    if (batches.length === 0) return;

    if (m.quantity > 0) {
      // Returns and upward counts with no batch named: back onto the newest batch.
      const newest = batches.reduce((a, b) => (b.receivedAt > a.receivedAt ? b : a));
      await tx.stockBatch.update({
        where: { id: newest.id },
        data: { quantityLeft: { increment: m.quantity } },
      });
    } else {
      const today = startOfToday();
      let need = -m.quantity;
      let expiredTaken = 0;
      const order = m.fromBatchId
        ? batches.filter((b) => b.id === m.fromBatchId)
        : [...batches]
            .filter((b) => b.quantityLeft > 0)
            .sort((a, b) => {
              // Good stock first, soonest expiry first; expired stock only when
              // nothing good is left; no-expiry batches after dated ones.
              const ax = a.expiryDate && a.expiryDate < today ? 1 : 0;
              const bx = b.expiryDate && b.expiryDate < today ? 1 : 0;
              if (ax !== bx) return ax - bx;
              const at = a.expiryDate?.getTime() ?? Infinity;
              const bt = b.expiryDate?.getTime() ?? Infinity;
              return at - bt || a.receivedAt.getTime() - b.receivedAt.getTime();
            });
      for (const b of order) {
        if (need <= 0) break;
        const take = m.fromBatchId ? need : Math.min(need, b.quantityLeft);
        if (take <= 0) continue;
        await tx.stockBatch.update({
          where: { id: b.id },
          data: {
            quantityLeft: { decrement: take },
            ...(m.fromBatchId && b.quantityLeft - take <= 0 ? { writtenOffAt: new Date() } : {}),
          },
        });
        if (b.expiryDate && b.expiryDate < today) expiredTaken += take;
        need -= take;
      }
      if (expiredTaken > 0) onExpiredTaken?.(expiredTaken);
    }
  }

  await refreshProductExpiry(tx, m.organizationId, m.productId);
}

/**
 * Product.expiryDate = the nearest still-good expiry with stock left, across
 * every branch. Tills read it, so a change bumps the catalog version.
 */
export async function refreshProductExpiry(
  tx: Prisma.TransactionClient,
  organizationId: string,
  productId: string,
) {
  const [next, product] = await Promise.all([
    tx.stockBatch.findFirst({
      where: {
        productId,
        writtenOffAt: null,
        quantityLeft: { gt: 0 },
        expiryDate: { gte: startOfToday() },
      },
      orderBy: { expiryDate: "asc" },
      select: { expiryDate: true },
    }),
    tx.product.findUnique({ where: { id: productId }, select: { expiryDate: true, trackExpiry: true } }),
  ]);
  if (!product) return;
  let nextDate = next?.expiryDate ?? null;
  if (!nextDate) {
    // Nothing good left: if expired stock is still on the shelf, show its date
    // so the till and the products list say "expired" instead of nothing.
    const stale = await tx.stockBatch.findFirst({
      where: { productId, writtenOffAt: null, quantityLeft: { gt: 0 }, expiryDate: { not: null } },
      orderBy: { expiryDate: "desc" },
      select: { expiryDate: true },
    });
    nextDate = stale?.expiryDate ?? null;
  }
  if ((product.expiryDate?.getTime() ?? null) === (nextDate?.getTime() ?? null) && (product.trackExpiry || !nextDate)) return;

  const version = await bumpCatalogVersion(organizationId, tx);
  await tx.product.update({
    where: { id: productId },
    data: { expiryDate: nextDate, version, ...(nextDate ? { trackExpiry: true } : {}) },
  });
}

/**
 * Set a level to an absolute figure — a physical count.
 *
 * Different from `applyMovement` in the way that matters: the manager says "I
 * counted 43", not "adjust by minus 7". Writing the delta is this function's job,
 * because a human should not have to subtract.
 *
 * Returns null when the count already matched, in which case nothing was written.
 * A no-op recount is worth suppressing — a ledger full of "counted 43, was 43"
 * rows buries the one recount that found a real discrepancy.
 */
export async function applyRecount(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    branchId: string;
    productId: string;
    countedQuantity: number;
    reason?: string | null;
    userId?: string | null;
  },
): Promise<{ delta: number; balance: number } | null> {
  const level = await tx.stockLevel.findUnique({
    where: {
      productId_branchId: { productId: input.productId, branchId: input.branchId },
    },
    select: { quantity: true },
  });

  const current = level?.quantity ?? 0;
  const delta = input.countedQuantity - current;
  if (delta === 0) return null;

  const balance = await applyMovement(
    tx,
    {
      organizationId: input.organizationId,
      branchId: input.branchId,
      productId: input.productId,
      quantity: delta,
      type: "RECOUNT",
      reason: input.reason ?? "Physical count",
      userId: input.userId ?? null,
    },
    // A recount is the one movement that may legitimately go negative: if the
    // system said 5 and there are none, the correct answer is minus five and a
    // conversation with whoever was supposed to be watching the door.
    { allowNegative: true },
  );

  return { delta, balance };
}

/**
 * Read the current quantity, defaulting to zero for a product that has never
 * moved. Callers doing this in a loop should fetch `StockLevel` rows in one
 * query instead — this is a convenience for single lookups.
 */
export async function currentQuantity(
  organizationId: string,
  productId: string,
  branchId: string,
): Promise<number> {
  const level = await prisma.stockLevel.findUnique({
    where: { productId_branchId: { productId, branchId } },
    select: { quantity: true, organizationId: true },
  });
  // The organizationId check is not decoration: productIds are cuids and not
  // secret, and this is the shape of query that leaks across tenants when
  // someone later adds a route that takes an id from the URL.
  if (!level || level.organizationId !== organizationId) return 0;
  return level.quantity;
}
