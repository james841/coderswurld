import "server-only";

import { prisma } from "./db";

/**
 * Reorder suggestions: how fast each product sells at a branch, how long the
 * stock on hand will last, and how many to buy to cover the next stretch.
 *
 *   daily rate   = units sold in the last 28 days / 28
 *   days left    = on hand / daily rate
 *   suggest      = daily rate x (cover days + delivery days) - on hand
 *
 * A product with no recent sales but at or under its reorder level is still
 * suggested, back up to twice that level, so slow movers are not forgotten.
 */

export const LOOKBACK_DAYS = 28;

export interface ReorderRow {
  productId: string;
  name: string;
  sku: string;
  unit: string;
  onHand: number;
  minStock: number;
  soldInPeriod: number;
  dailyRate: number;
  daysLeft: number | null; // null = not selling
  suggestQty: number;
  costPriceKobo: number;
  supplierId: string | null;
  supplierName: string | null;
  supplierPhone: string | null;
}

export async function buildReorderList(opts: {
  organizationId: string;
  branchId: string;
  department: string | null;
  coverDays: number;
  leadDays: number;
  defaultLowStock: number;
}): Promise<ReorderRow[]> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);

  const [products, sold] = await Promise.all([
    prisma.product.findMany({
      where: {
        organizationId: opts.organizationId,
        isActive: true,
        ...(opts.department ? { department: opts.department } : {}),
      },
      select: {
        id: true,
        name: true,
        sku: true,
        unit: true,
        minStock: true,
        costPriceKobo: true,
        supplier: { select: { id: true, name: true, phone: true, whatsapp: true } },
        stockLevels: { where: { branchId: opts.branchId }, select: { quantity: true } },
      },
    }),
    prisma.stockMovement.groupBy({
      by: ["productId"],
      where: {
        organizationId: opts.organizationId,
        branchId: opts.branchId,
        type: "SALE",
        createdAt: { gte: since },
      },
      _sum: { quantity: true },
    }),
  ]);

  const soldMap = new Map(sold.map((s) => [s.productId, -(s._sum.quantity ?? 0)]));
  const horizon = opts.coverDays + opts.leadDays;
  const rows: ReorderRow[] = [];

  for (const p of products) {
    const onHand = p.stockLevels[0]?.quantity ?? 0;
    const soldQty = Math.max(0, soldMap.get(p.id) ?? 0);
    const rate = soldQty / LOOKBACK_DAYS;
    const floor = p.minStock > 0 ? p.minStock : opts.defaultLowStock;

    let suggest = 0;
    if (rate > 0) {
      suggest = rate * horizon - onHand;
      // Never leave it under its own reorder level after the delivery lands.
      suggest = Math.max(suggest, floor - onHand);
    } else if (p.minStock > 0 && onHand <= p.minStock) {
      suggest = p.minStock * 2 - onHand;
    }
    const qty = Math.ceil(suggest);
    if (qty <= 0) continue;

    rows.push({
      productId: p.id,
      name: p.name,
      sku: p.sku,
      unit: p.unit,
      onHand,
      minStock: p.minStock,
      soldInPeriod: soldQty,
      dailyRate: rate,
      daysLeft: rate > 0 ? Math.max(0, onHand / rate) : null,
      suggestQty: qty,
      costPriceKobo: p.costPriceKobo,
      supplierId: p.supplier?.id ?? null,
      supplierName: p.supplier?.name ?? null,
      supplierPhone: p.supplier?.whatsapp || p.supplier?.phone || null,
    });
  }

  // Most urgent first: out of stock, then fewest days left.
  return rows.sort((a, b) => (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999));
}
