import { NextResponse } from "next/server";

import { AppError, handle, readJson } from "@/lib/api";
import { prisma } from "@/lib/db";
import { requireTenantApi } from "@/lib/auth";
import { requirePermission } from "@/lib/permissions";
import { PERMISSIONS } from "@/lib/constants";
import { nextReceiptNumber } from "@/lib/sequence";
import { applyMovement } from "@/lib/stock";
import {
  computeTotals,
  resolveUnitPrice,
  saleSubmitSchema,
  settle,
  type CatalogStock,
  type SaleResult,
} from "@/lib/pos";

/**
 * POST /api/pos/sales — record one sale.
 *
 * This is the one write in the system that happens with a customer physically
 * waiting, so three things are load-bearing:
 *
 * 1. IT IS IDEMPOTENT. The till mints a `localId` before sending and keeps the
 *    sale queued until it hears back. A dropped response, a retry, a replayed
 *    offline sale — all carry the same `localId`, and the unique index on
 *    (organizationId, localId) means the second attempt returns the first
 *    sale's receipt rather than charging the customer twice. A double-charge is
 *    the single worst bug a till can have; the whole design bends to prevent it.
 *
 * 2. THE SERVER PRICES THE SALE, NOT THE TILL. Quantities, discounts and
 *    payments come from the client; cost and the authoritative selling price are
 *    read from the product row here. A tampered or stale till cannot sell at a
 *    price the catalogue doesn't hold — except where the cashier holds the
 *    price-override permission, the one sanctioned exception.
 *
 * 3. IT IS ONE TRANSACTION. Receipt number, sale, line items and every stock
 *    movement land together or not at all. A sale whose stock didn't move, or
 *    stock that moved without a sale, is a figure no count will ever reconcile.
 *
 * It does NOT bump the catalog version: a sale moves stock, and stock reaches
 * the till through level rows, not the catalogue. Bumping here would make every
 * till resync its whole catalogue after every sale — the exact traffic the
 * delta-sync design exists to avoid.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const session = await requireTenantApi();
    requirePermission(session.user, PERMISSIONS.POS_SELL);

    if (!session.branch) {
      throw new AppError(
        "This till isn't attached to a shop branch, so there's nowhere to record the sale.",
        { status: 400 },
      );
    }
    const orgId = session.org.id;
    const branch = session.branch;

    const data = saleSubmitSchema.parse(await readJson(request));

    // ── Idempotency: has this exact sale already landed? ────────────────────
    // Checked before any work so a replay is cheap and never touches stock.
    const existing = await prisma.sale.findUnique({
      where: { organizationId_localId: { organizationId: orgId, localId: data.localId } },
      select: saleResultSelect,
    });
    if (existing) {
      return NextResponse.json(await toSaleResult(existing, true), { status: 200 });
    }

    // ── Settings that change how a sale is priced and settled ───────────────
    const settings = await prisma.orgSettings.findUnique({
      where: { organizationId: orgId },
      select: {
        autoWholesale: true,
        allowNegativeStock: true,
        requireCustomerForCredit: true,
        vatEnabled: true,
        vatBasisPoints: true,
        vatInclusive: true,
      },
    });
    const autoWholesale = settings?.autoWholesale ?? true;
    const allowNegativeStock = settings?.allowNegativeStock ?? false;
    const requireCustomerForCredit = settings?.requireCustomerForCredit ?? true;

    // ── Load the products this sale touches, scoped to the org ──────────────
    const productIds = [...new Set(data.lines.map((l) => l.productId))];
    const products = await prisma.product.findMany({
      where: { organizationId: orgId, id: { in: productIds } },
      select: {
        id: true,
        name: true,
        sku: true,
        barcode: true,
        unit: true,
        sellingPriceKobo: true,
        wholesalePriceKobo: true,
        wholesaleMinQty: true,
        costPriceKobo: true,
        isActive: true,
        department: true,
      },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    // ── Resolve each line: price, cost snapshot, discount, profit ───────────
    let discountRequested = data.orderDiscountKobo > 0;

    const lines = data.lines.map((line) => {
      const product = byId.get(line.productId);
      if (!product) {
        throw new AppError("A product on this sale no longer exists. Refresh the till.", {
          status: 422,
        });
      }
      // A sale made offline before the product was deleted still happened.
      if (!product.isActive && !data.queued) {
        throw new AppError(`${product.name} has been removed and can't be sold.`, {
          status: 422,
        });
      }
      // A cashier assigned to one department sells only that department's
      // products. Checked here, not just hidden at the till, so an edited
      // browser can't get round it.
      const department = session.user.department;
      if (department && product.department !== department) {
        throw new AppError(
          `${product.name} belongs to the ${product.department === "PHARMACY" ? "pharmacy" : "supermarket"}, and you are assigned to the ${department === "PHARMACY" ? "pharmacy" : "supermarket"}.`,
          { status: 403 },
        );
      }

      const resolved = resolveUnitPrice(product, line.quantity, line.priceMode ?? data.priceMode, autoWholesale);

      let unitPriceKobo = resolved.unitPriceKobo;
      if (
        line.overrideUnitPriceKobo !== undefined &&
        line.overrideUnitPriceKobo !== resolved.unitPriceKobo
      ) {
        // A typed-over price is honoured only with the permission — sending one
        // without it is simply ignored, never an error the cashier can exploit.
        requirePermission(session.user, PERMISSIONS.POS_PRICE_OVERRIDE);
        unitPriceKobo = line.overrideUnitPriceKobo;
      }

      if (line.discountKobo > 0) discountRequested = true;

      const gross = Math.round(unitPriceKobo * line.quantity);
      const lineTotalKobo = Math.max(0, gross - line.discountKobo);
      const costKobo = Math.round(product.costPriceKobo * line.quantity);

      return {
        product,
        quantity: line.quantity,
        unitPriceKobo,
        unitCostKobo: product.costPriceKobo,
        discountKobo: line.discountKobo,
        lineTotalKobo,
        lineProfitKobo: lineTotalKobo - costKobo,
        costKobo,
        priceType: resolved.priceType,
      };
    });

    // Discounts are a permission, whether applied to a line or the whole order.
    if (discountRequested) {
      requirePermission(session.user, PERMISSIONS.POS_DISCOUNT);
    }

    // ── Totals and settlement, by the shared maths ──────────────────────────
    const totals = computeTotals(
      lines.map((l) => ({
        unitPriceKobo: l.unitPriceKobo,
        quantity: l.quantity,
        discountKobo: l.discountKobo,
      })),
      data.orderDiscountKobo,
      settings
        ? {
            enabled: settings.vatEnabled,
            basisPoints: settings.vatBasisPoints,
            inclusive: settings.vatInclusive,
          }
        : undefined,
    );

    if (totals.totalKobo <= 0) {
      throw new AppError("This sale comes to nothing — add an item or reduce the discount.", {
        status: 422,
      });
    }

    const settlement = settle({
      totalKobo: totals.totalKobo,
      payments: data.payments,
      tenderedKobo: data.tenderedKobo,
    });

    // ── Credit: a sale left owing needs the permission, and usually a name ──
    let customerId: string | null = null;
    if (settlement.balanceKobo > 0) {
      requirePermission(session.user, PERMISSIONS.POS_CREDIT_SALE);
      if (data.customerId) {
        const customer = await prisma.customer.findFirst({
          where: { id: data.customerId, organizationId: orgId },
          select: { id: true },
        });
        if (!customer) {
          throw new AppError("That customer isn't on file.", {
            status: 422,
            fields: { customer: "Unknown customer" },
          });
        }
        customerId = customer.id;
      } else if (requireCustomerForCredit) {
        throw new AppError("A credit sale must be put to a named customer.", {
          status: 422,
          fields: { customer: "Choose who is owing" },
        });
      }
    } else if (data.customerId) {
      // A fully-paid sale may still be attributed to a customer (loyalty, history).
      const customer = await prisma.customer.findFirst({
        where: { id: data.customerId, organizationId: orgId },
        select: { id: true },
      });
      customerId = customer?.id ?? null;
    }

    const costTotalKobo = lines.reduce((sum, l) => sum + l.costKobo, 0);
    const profitKobo = totals.subtotalKobo - totals.orderDiscountKobo - costTotalKobo;

    // When was it sold? Shop computers often have the wrong date or time (a weak
    // clock battery, a wrong time zone), and trusting that clock filed whole
    // days of takings under the wrong day, so "today's sales" read low or empty.
    //  - Online sale: it is happening now, so the server's clock decides.
    //  - Offline sale sent later: the till's time is all we have, but the till
    //    also says what its clock read when it sent the sale. The gap between
    //    that and the server's clock is how wrong the till's clock is, and we
    //    correct the sale time by it. Never later than now.
    const now = new Date();
    let soldAt = now;
    if (data.queued && data.soldAt) {
      const claimed = new Date(data.soldAt).getTime();
      const skew = data.sentAt ? now.getTime() - new Date(data.sentAt).getTime() : 0;
      soldAt = new Date(Math.min(claimed + skew, now.getTime()));
    }

    const isSplit = settlement.method === "SPLIT";

    const result = await prisma.$transaction(async (tx) => {
      const receiptNo = await nextReceiptNumber(tx, orgId, branch.code);

      const sale = await tx.sale.create({
        data: {
          organizationId: orgId,
          branchId: branch.id,
          cashierId: session.user.id,
          customerId,
          receiptNo,
          localId: data.localId,
          deviceId: data.deviceId ?? null,
          subtotalKobo: totals.subtotalKobo,
          discountKobo: totals.discountKobo,
          taxKobo: totals.taxKobo,
          totalKobo: totals.totalKobo,
          costTotalKobo,
          profitKobo,
          tenderedKobo: data.tenderedKobo,
          changeKobo: settlement.changeKobo,
          paidKobo: settlement.paidKobo,
          balanceKobo: settlement.balanceKobo,
          paymentMethod: settlement.method,
          paymentBreakdown: isSplit ? JSON.stringify(data.payments) : null,
          priceMode: data.priceMode,
          status: "COMPLETED",
          note: data.note ?? null,
          soldAt,
          syncedAt: now,
          items: {
            create: lines.map((l) => ({
              organizationId: orgId,
              productId: l.product.id,
              productName: l.product.name,
              sku: l.product.sku,
              barcode: l.product.barcode,
              unit: l.product.unit,
              quantity: l.quantity,
              unitPriceKobo: l.unitPriceKobo,
              unitCostKobo: l.unitCostKobo,
              discountKobo: l.discountKobo,
              lineTotalKobo: l.lineTotalKobo,
              lineProfitKobo: l.lineProfitKobo,
              priceType: l.priceType,
            })),
          },
        },
        select: saleResultSelect,
      });

      // Draw the stock down through the ledger, one movement per line. The
      // quantity is negative — this is stock leaving — and the running balance
      // comes back so the till can reconcile its own copy without a resync.
      const stock: CatalogStock[] = [];
      const expiredSold: { id: string; name: string; qty: number }[] = [];
      for (const l of lines) {
        const balance = await applyMovement(
          tx,
          {
            organizationId: orgId,
            branchId: branch.id,
            productId: l.product.id,
            quantity: -l.quantity,
            type: "SALE",
            unitCostKobo: l.unitCostKobo,
            referenceType: "SALE",
            referenceId: sale.id,
            userId: session.user.id,
          },
          {
            // An offline sale already left the shop with the customer. If other
            // tills sold the same stock meanwhile, the level goes below zero and
            // shows up for a recount, rather than the sale being refused.
            allowNegative: allowNegativeStock || data.queued === true,
            onExpiredTaken: (q) => expiredSold.push({ id: l.product.id, name: l.product.name, qty: q }),
          },
        );
        stock.push({ p: l.product.id, q: balance });
      }

      if (customerId && (settlement.balanceKobo > 0 || totals.totalKobo > 0)) {
        await tx.customer.update({
          where: { id: customerId },
          data: {
            balanceKobo: { increment: settlement.balanceKobo },
            totalSpentKobo: { increment: totals.totalKobo },
            purchaseCount: { increment: 1 },
            lastPurchaseAt: soldAt,
          },
        });
      }

      return { sale, stock, expiredSold };
    });

    // Best-effort device touch, outside the transaction: a stale "last synced"
    // must never roll back a committed sale.
    if (data.deviceId) {
      void prisma.device
        .updateMany({
          where: { organizationId: orgId, deviceId: data.deviceId },
          data: { lastSeenAt: now, lastSyncAt: now },
        })
        .catch(() => {});
    }

    // Expired stock left the shelf because nothing in date was left. Tell the
    // managers, once per product per day; never block the sale already made.
    for (const e of result.expiredSold) {
      const day = now.toISOString().slice(0, 10);
      void prisma.notification
        .upsert({
          where: { organizationId_dedupeKey: { organizationId: orgId, dedupeKey: `EXPIRED_SOLD:${e.id}:${day}` } },
          create: {
            organizationId: orgId,
            type: "EXPIRED",
            severity: "CRITICAL",
            title: `Expired ${e.name} was sold`,
            body: `${e.qty} came from an expired batch because no in-date stock was left. Remove the expired batch on the Expiry page.`,
            linkHref: "/stock/expiry",
            entityType: "PRODUCT",
            entityId: e.id,
            dedupeKey: `EXPIRED_SOLD:${e.id}:${day}`,
          },
          update: { count: { increment: 1 }, isRead: false },
        })
        .catch(() => {});
    }

    const payload = await toSaleResult(result.sale, false, result.stock);
    return NextResponse.json(payload, { status: 201 });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Shaping the response — one shape for a fresh sale and a replayed one
// ─────────────────────────────────────────────────────────────────────────────

const saleResultSelect = {
  id: true,
  receiptNo: true,
  soldAt: true,
  subtotalKobo: true,
  discountKobo: true,
  taxKobo: true,
  totalKobo: true,
  paidKobo: true,
  balanceKobo: true,
  tenderedKobo: true,
  changeKobo: true,
  paymentMethod: true,
  priceMode: true,
  customerId: true,
} as const;

type SaleRow = {
  id: string;
  receiptNo: string;
  soldAt: Date;
  subtotalKobo: number;
  discountKobo: number;
  taxKobo: number;
  totalKobo: number;
  paidKobo: number;
  balanceKobo: number;
  tenderedKobo: number;
  changeKobo: number;
  paymentMethod: string;
  priceMode: string;
  customerId: string | null;
};

/**
 * Build the till's result. On a replay (`duplicate`) the stock figures aren't
 * known from the write that already happened, so they're read fresh — the till
 * still gets authoritative quantities to reconcile against.
 */
async function toSaleResult(
  sale: SaleRow,
  duplicate: boolean,
  stock?: CatalogStock[],
): Promise<SaleResult> {
  let stockOut = stock ?? [];
  if (duplicate) {
    const items = await prisma.saleItem.findMany({
      where: { saleId: sale.id },
      select: { productId: true },
    });
    const ids = [...new Set(items.map((i) => i.productId).filter((v): v is string => !!v))];
    if (ids.length > 0) {
      const levels = await prisma.stockLevel.findMany({
        where: { productId: { in: ids } },
        select: { productId: true, quantity: true },
      });
      stockOut = levels.map((l) => ({ p: l.productId, q: l.quantity }));
    }
  }

  return {
    ok: true,
    duplicate,
    sale: {
      id: sale.id,
      receiptNo: sale.receiptNo,
      soldAt: sale.soldAt.toISOString(),
      subtotalKobo: sale.subtotalKobo,
      discountKobo: sale.discountKobo,
      taxKobo: sale.taxKobo,
      totalKobo: sale.totalKobo,
      paidKobo: sale.paidKobo,
      balanceKobo: sale.balanceKobo,
      tenderedKobo: sale.tenderedKobo,
      changeKobo: sale.changeKobo,
      paymentMethod: sale.paymentMethod as SaleResult["sale"]["paymentMethod"],
      priceMode: sale.priceMode as SaleResult["sale"]["priceMode"],
      customerId: sale.customerId,
    },
    stock: stockOut,
  };
}
