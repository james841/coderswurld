import "server-only";

import type { Prisma } from "@prisma/client";

import { AppError } from "./api";
import { formatNaira } from "./money";
import { applyMovement, refreshProductExpiry } from "./stock";

/**
 * Correct a purchase after it was recorded.
 *
 * Mistakes happen at the delivery door: 50 typed for 5, the wrong product
 * picked, a cost with an extra zero, the wrong supplier. This changes the
 * purchase to what really happened and moves stock by the DIFFERENCE only, so
 * everything sold since stays exactly as it was. Every correction is written
 * down: who, when, why, and each old and new value.
 */

export interface CorrectionLine {
  /** The existing line being changed. Absent for a line added in the correction. */
  id?: string | null;
  productId: string;
  quantity: number;
  unitCostKobo: number;
  batchNo: string | null;
  expiryDate: Date | null;
}

export interface CorrectionInput {
  reason: string;
  supplierId: string;
  invoiceNo: string | null;
  purchaseDate: Date;
  transportKobo: number;
  otherCostKobo: number;
  note: string | null;
  lines: CorrectionLine[];
}

interface Actor {
  organizationId: string;
  userId: string;
  userName: string;
}

const MAX_KOBO = 2_000_000_000;

function qtyText(q: number, unit: string) {
  return `${new Intl.NumberFormat("en-NG", { maximumFractionDigits: 3 }).format(q)} ${unit}`;
}
function dateText(d: Date | null) {
  return d ? d.toISOString().slice(0, 10) : "none";
}
function sameDay(a: Date | null, b: Date | null) {
  return dateText(a) === dateText(b);
}

async function loadPurchase(tx: Prisma.TransactionClient, organizationId: string, purchaseId: string) {
  const purchase = await tx.purchase.findFirst({
    where: { id: purchaseId, organizationId },
    include: {
      supplier: { select: { id: true, name: true } },
      items: { include: { product: { select: { id: true, name: true, unit: true } } } },
    },
  });
  if (!purchase) throw new AppError("That purchase no longer exists.", { status: 404 });
  if (purchase.status === "CANCELLED") {
    throw new AppError("This purchase was cancelled, so it can't be changed.", { status: 409 });
  }
  return purchase;
}

/** The batch a purchase line opened, if it opened one. */
async function batchFor(
  tx: Prisma.TransactionClient,
  purchaseId: string,
  branchId: string,
  item: { productId: string; batchNo: string | null; expiryDate: Date | null },
) {
  const batches = await tx.stockBatch.findMany({
    where: { referenceId: purchaseId, productId: item.productId, branchId, source: "PURCHASE" },
    select: { id: true, batchNo: true, expiryDate: true, quantityLeft: true, quantityReceived: true },
  });
  return (
    batches.find((b) => (b.batchNo ?? null) === (item.batchNo ?? null) && sameDay(b.expiryDate, item.expiryDate)) ??
    batches[0] ??
    null
  );
}

/**
 * Take stock back out. Refuses, by name, when the shelf no longer holds that
 * many: they were sold, and a purchase correction must not invent a negative
 * stock level. The fix then is a stock count, which the message says.
 */
async function takeBack(
  tx: Prisma.TransactionClient,
  ctx: { organizationId: string; branchId: string; purchaseId: string; userId: string; reason: string },
  product: { id: string; name: string; unit: string },
  quantity: number,
  batch: { id: string; quantityLeft: number } | null,
) {
  const level = await tx.stockLevel.findUnique({
    where: { productId_branchId: { productId: product.id, branchId: ctx.branchId } },
    select: { quantity: true },
  });
  const onHand = level?.quantity ?? 0;
  if (onHand < quantity) {
    throw new AppError(
      `Can't take ${qtyText(quantity, product.unit)} of ${product.name} back out: only ${qtyText(onHand, product.unit)} is in stock now, because some has been sold. Correct the rest with a stock count on the Stock page.`,
      { status: 409 },
    );
  }
  await applyMovement(tx, {
    organizationId: ctx.organizationId,
    branchId: ctx.branchId,
    productId: product.id,
    quantity: -quantity,
    type: "PURCHASE_EDIT",
    referenceType: "PURCHASE",
    referenceId: ctx.purchaseId,
    reason: ctx.reason,
    userId: ctx.userId,
    fromBatchId: batch && batch.quantityLeft >= quantity ? batch.id : null,
  });
}

export async function correctPurchase(
  tx: Prisma.TransactionClient,
  actor: Actor,
  purchaseId: string,
  input: CorrectionInput,
) {
  const purchase = await loadPurchase(tx, actor.organizationId, purchaseId);
  const ctx = {
    organizationId: actor.organizationId,
    branchId: purchase.branchId,
    purchaseId,
    userId: actor.userId,
    reason: input.reason,
  };
  const changes: string[] = [];

  // ── Products: every line must be this shop's product ───────────────────────
  const productIds = [...new Set(input.lines.map((l) => l.productId))];
  const products = await tx.product.findMany({
    where: { organizationId: actor.organizationId, id: { in: productIds } },
    select: { id: true, name: true, unit: true },
  });
  const productById = new Map(products.map((p) => [p.id, p]));
  for (const l of input.lines) {
    if (!productById.has(l.productId)) {
      throw new AppError("A product on this purchase no longer exists. Refresh and try again.", { status: 422 });
    }
  }

  const oldById = new Map(purchase.items.map((it) => [it.id, it]));
  for (const l of input.lines) {
    if (l.id && !oldById.has(l.id)) {
      throw new AppError("This purchase changed while you were editing it. Refresh and try again.", { status: 409 });
    }
  }
  const newById = new Map(input.lines.filter((l) => l.id).map((l) => [l.id as string, l]));

  // ── Existing lines: removed or changed ─────────────────────────────────────
  for (const item of purchase.items) {
    const product = item.product;
    const next = newById.get(item.id);
    const batch = await batchFor(tx, purchaseId, purchase.branchId, item);

    if (!next || next.productId !== item.productId) {
      // Removed (or swapped for another product, which arrives below as a new line).
      await takeBack(tx, ctx, product, item.quantity, batch);
      if (batch) {
        await tx.stockBatch.update({
          where: { id: batch.id },
          data: { quantityReceived: Math.max(0, batch.quantityReceived - item.quantity) },
        });
      }
      await tx.purchaseItem.delete({ where: { id: item.id } });
      changes.push(
        `Removed ${product.name}: ${qtyText(item.quantity, product.unit)} at ${formatNaira(item.unitCostKobo)}.`,
      );
      if (next) {
        // Same line id now names a different product: treat it as a new line.
        newById.delete(item.id);
        input.lines = input.lines.map((l) => (l === next ? { ...l, id: null } : l));
      }
      continue;
    }

    const delta = next.quantity - item.quantity;
    if (delta < 0) {
      await takeBack(tx, ctx, product, -delta, batch);
    } else if (delta > 0) {
      await applyMovement(tx, {
        organizationId: actor.organizationId,
        branchId: purchase.branchId,
        productId: product.id,
        quantity: delta,
        type: "PURCHASE_EDIT",
        unitCostKobo: next.unitCostKobo,
        referenceType: "PURCHASE",
        referenceId: purchaseId,
        reason: input.reason,
        userId: actor.userId,
        toBatchId: batch?.id ?? null,
      });
    }
    if (delta !== 0) {
      changes.push(
        `${product.name}: quantity ${qtyText(item.quantity, product.unit)} to ${qtyText(next.quantity, product.unit)}.`,
      );
    }
    if (next.unitCostKobo !== item.unitCostKobo) {
      changes.push(`${product.name}: cost ${formatNaira(item.unitCostKobo)} to ${formatNaira(next.unitCostKobo)} each.`);
    }
    if ((next.batchNo ?? null) !== (item.batchNo ?? null)) {
      changes.push(`${product.name}: batch "${item.batchNo ?? "none"}" to "${next.batchNo ?? "none"}".`);
    }
    if (!sameDay(next.expiryDate, item.expiryDate)) {
      changes.push(`${product.name}: expiry ${dateText(item.expiryDate)} to ${dateText(next.expiryDate)}.`);
    }

    if (batch) {
      await tx.stockBatch.update({
        where: { id: batch.id },
        data: {
          batchNo: next.batchNo,
          expiryDate: next.expiryDate,
          unitCostKobo: next.unitCostKobo,
          quantityReceived: next.quantity,
        },
      });
      if (!sameDay(next.expiryDate, item.expiryDate)) {
        await refreshProductExpiry(tx, actor.organizationId, product.id);
      }
    }

    await tx.purchaseItem.update({
      where: { id: item.id },
      data: {
        quantity: next.quantity,
        unitCostKobo: next.unitCostKobo,
        lineTotalKobo: Math.round(next.quantity * next.unitCostKobo),
        batchNo: next.batchNo,
        expiryDate: next.expiryDate,
      },
    });
  }

  // ── New lines ──────────────────────────────────────────────────────────────
  for (const l of input.lines.filter((x) => !x.id)) {
    const product = productById.get(l.productId)!;
    await applyMovement(tx, {
      organizationId: actor.organizationId,
      branchId: purchase.branchId,
      productId: product.id,
      quantity: l.quantity,
      type: "PURCHASE_EDIT",
      unitCostKobo: l.unitCostKobo,
      referenceType: "PURCHASE",
      referenceId: purchaseId,
      reason: input.reason,
      userId: actor.userId,
      batch: { batchNo: l.batchNo, expiryDate: l.expiryDate, source: "PURCHASE" },
    });
    await tx.purchaseItem.create({
      data: {
        organizationId: actor.organizationId,
        purchaseId,
        productId: product.id,
        quantity: l.quantity,
        unitCostKobo: l.unitCostKobo,
        lineTotalKobo: Math.round(l.quantity * l.unitCostKobo),
        batchNo: l.batchNo,
        expiryDate: l.expiryDate,
      },
    });
    changes.push(`Added ${product.name}: ${qtyText(l.quantity, product.unit)} at ${formatNaira(l.unitCostKobo)}.`);
  }

  // ── Standing cost: only if this is still the latest purchase of the product ─
  for (const l of input.lines) {
    if (l.unitCostKobo <= 0) continue;
    const newer = await tx.purchaseItem.count({
      where: {
        organizationId: actor.organizationId,
        productId: l.productId,
        purchase: { purchaseDate: { gt: purchase.purchaseDate }, status: { not: "CANCELLED" } },
      },
    });
    if (newer === 0) {
      await tx.product.update({ where: { id: l.productId }, data: { costPriceKobo: l.unitCostKobo } });
    }
  }

  // ── Header ─────────────────────────────────────────────────────────────────
  if ((input.invoiceNo ?? null) !== (purchase.invoiceNo ?? null)) {
    changes.push(`Invoice number "${purchase.invoiceNo ?? "none"}" to "${input.invoiceNo ?? "none"}".`);
  }
  if (!sameDay(input.purchaseDate, purchase.purchaseDate)) {
    changes.push(`Date ${dateText(purchase.purchaseDate)} to ${dateText(input.purchaseDate)}.`);
  }
  if (input.transportKobo !== purchase.transportKobo) {
    changes.push(`Transport ${formatNaira(purchase.transportKobo)} to ${formatNaira(input.transportKobo)}.`);
  }
  if (input.otherCostKobo !== purchase.otherCostKobo) {
    changes.push(`Other costs ${formatNaira(purchase.otherCostKobo)} to ${formatNaira(input.otherCostKobo)}.`);
  }
  if ((input.note ?? null) !== (purchase.note ?? null)) {
    changes.push("Note changed.");
  }

  // ── Totals and what is owed ────────────────────────────────────────────────
  const subtotalKobo = input.lines.reduce((sum, l) => sum + Math.round(l.quantity * l.unitCostKobo), 0);
  const totalKobo = subtotalKobo + input.transportKobo + input.otherCostKobo;
  if (totalKobo <= 0) {
    throw new AppError("This purchase would come to nothing. To remove it completely, use Cancel purchase.", {
      status: 422,
    });
  }
  if (totalKobo > MAX_KOBO) {
    throw new AppError("This purchase is too large to record in one entry.", { status: 422 });
  }
  if (purchase.amountPaidKobo > totalKobo) {
    throw new AppError(
      `You have already paid ${formatNaira(purchase.amountPaidKobo)} on this purchase, more than the corrected total of ${formatNaira(totalKobo)}. Ask the supplier for the difference first.`,
      { status: 422 },
    );
  }
  const balanceKobo = totalKobo - purchase.amountPaidKobo;
  const paymentStatus = purchase.amountPaidKobo <= 0 ? "UNPAID" : balanceKobo <= 0 ? "PAID" : "PARTIAL";
  if (totalKobo !== purchase.totalKobo) {
    changes.push(`Total ${formatNaira(purchase.totalKobo)} to ${formatNaira(totalKobo)}.`);
  }

  // Supplier: the balance owed follows the purchase.
  let supplierName = purchase.supplier.name;
  if (input.supplierId !== purchase.supplierId) {
    const supplier = await tx.supplier.findFirst({
      where: { id: input.supplierId, organizationId: actor.organizationId },
      select: { id: true, name: true },
    });
    if (!supplier) throw new AppError("Choose who you bought from.", { status: 422, fields: { supplierId: "Not found" } });
    supplierName = supplier.name;
    if (purchase.balanceKobo !== 0) {
      await tx.supplier.update({
        where: { id: purchase.supplierId },
        data: { balanceKobo: { decrement: purchase.balanceKobo } },
      });
    }
    if (balanceKobo !== 0) {
      await tx.supplier.update({ where: { id: supplier.id }, data: { balanceKobo: { increment: balanceKobo } } });
    }
    await tx.payment.updateMany({ where: { purchaseId }, data: { supplierId: supplier.id } });
    changes.push(`Supplier ${purchase.supplier.name} to ${supplier.name}.`);
  } else if (balanceKobo !== purchase.balanceKobo) {
    await tx.supplier.update({
      where: { id: purchase.supplierId },
      data: { balanceKobo: { increment: balanceKobo - purchase.balanceKobo } },
    });
  }

  if (changes.length === 0) {
    throw new AppError("Nothing was changed.", { status: 422 });
  }

  const now = new Date();
  await tx.purchase.update({
    where: { id: purchaseId },
    data: {
      supplierId: input.supplierId,
      invoiceNo: input.invoiceNo,
      purchaseDate: input.purchaseDate.getTime() > now.getTime() ? now : input.purchaseDate,
      transportKobo: input.transportKobo,
      otherCostKobo: input.otherCostKobo,
      note: input.note,
      subtotalKobo,
      totalKobo,
      balanceKobo,
      paymentStatus,
    },
  });

  await tx.purchaseChange.create({
    data: {
      organizationId: actor.organizationId,
      purchaseId,
      action: "EDIT",
      reason: input.reason,
      details: JSON.stringify(changes),
      userId: actor.userId,
      userName: actor.userName,
    },
  });

  return { changes, totalKobo, balanceKobo, supplierName };
}

/**
 * Cancel a purchase entered by mistake (entered twice, wrong shop). Takes all
 * its stock back out and clears what it said was owed. Refused when money was
 * already paid against it: that cash really left, so it needs a correction,
 * not a cancel.
 */
export async function cancelPurchase(tx: Prisma.TransactionClient, actor: Actor, purchaseId: string, reason: string) {
  const purchase = await loadPurchase(tx, actor.organizationId, purchaseId);
  if (purchase.amountPaidKobo > 0) {
    throw new AppError(
      `${formatNaira(purchase.amountPaidKobo)} was already paid on this purchase, so it can't be cancelled. Use Correct this purchase to fix what's wrong instead.`,
      { status: 409 },
    );
  }
  const ctx = { organizationId: actor.organizationId, branchId: purchase.branchId, purchaseId, userId: actor.userId, reason };
  const lines: string[] = [];
  for (const item of purchase.items) {
    const batch = await batchFor(tx, purchaseId, purchase.branchId, item);
    await takeBack(tx, ctx, item.product, item.quantity, batch);
    if (batch) {
      await tx.stockBatch.update({
        where: { id: batch.id },
        data: { quantityReceived: Math.max(0, batch.quantityReceived - item.quantity) },
      });
    }
    lines.push(`Took back ${qtyText(item.quantity, item.product.unit)} of ${item.product.name}.`);
  }
  if (purchase.balanceKobo !== 0) {
    await tx.supplier.update({
      where: { id: purchase.supplierId },
      data: { balanceKobo: { decrement: purchase.balanceKobo } },
    });
    lines.push(`Cleared ${formatNaira(purchase.balanceKobo)} owed to ${purchase.supplier.name}.`);
  }
  await tx.purchase.update({
    where: { id: purchaseId },
    data: { status: "CANCELLED", balanceKobo: 0 },
  });
  await tx.purchaseChange.create({
    data: {
      organizationId: actor.organizationId,
      purchaseId,
      action: "CANCEL",
      reason,
      details: JSON.stringify(lines),
      userId: actor.userId,
      userName: actor.userName,
    },
  });
  return { changes: lines };
}
