import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError, handle, readJson } from "@/lib/api";
import { prisma } from "@/lib/db";
import { requireTenantApi } from "@/lib/auth";
import { requirePermission } from "@/lib/permissions";
import { PERMISSIONS } from "@/lib/constants";
import { nextPurchaseNumber } from "@/lib/sequence";
import { applyMovement } from "@/lib/stock";

/**
 * Purchases — goods received from a supplier or market.
 *
 * This is the inbound mirror of a sale, and it leans on the same spine:
 * `applyMovement` writes a `PURCHASE` row to the stock ledger and bumps the
 * cached level, all inside one transaction that also mints the PO number,
 * writes the purchase and its lines, and moves the supplier's balance. Stock in
 * and stock out are the same machinery pointed in opposite directions, so a
 * received quantity reaches the till exactly the way a sold one does — through
 * the stock-level cursor, never the catalogue. That is why this route, like the
 * sale route, deliberately does NOT bump `catalogVersion`: a delivery changes
 * how much is on hand, not what the product *is*.
 *
 * What it DOES quietly update on the product is cost: the price you just paid is
 * the best answer to "what does this cost me now", and margin reporting is only
 * honest if that number is current. Cost never travels to the till, so updating
 * it needs no version bump.
 */

// Postgres `Int` tops out at 2,147,483,647 kobo (~₦21.47m). Reject anything that
// would overflow a money column with a clean 422 instead of a 500 from the DB.
const MAX_KOBO = 2_000_000_000;

/** Supplier payments are cash-out: cheque belongs here, "on credit" does not. */
const PURCHASE_PAYMENT_METHODS = ["CASH", "TRANSFER", "POS", "CHEQUE"] as const;

/** "" / null / undefined all mean "no date"; anything else is coerced to a Date. */
const emptyToNull = (v: unknown) =>
  v === "" || v === null || v === undefined ? null : v;

const LineSchema = z.object({
  productId: z.string().min(1),
  quantity: z
    .number()
    .positive("Quantity must be more than zero.")
    .max(1_000_000, "That quantity looks wrong."),
  unitCostKobo: z
    .number()
    .int()
    .min(0, "Cost can't be negative.")
    .max(MAX_KOBO, "That cost is too large to record."),
  batchNo: z
    .string()
    .trim()
    .max(60)
    .optional()
    .transform((v) => v || null),
  expiryDate: z
    .preprocess(emptyToNull, z.coerce.date().nullable())
    .optional(),
});

const CreateSchema = z.object({
  supplierId: z.string().min(1, "Choose who you bought from."),
  branchId: z.string().min(1).optional(),
  invoiceNo: z
    .string()
    .trim()
    .max(60)
    .optional()
    .transform((v) => v || null),
  purchaseDate: z.preprocess(emptyToNull, z.coerce.date().nullable()).optional(),
  transportKobo: z.number().int().min(0).max(MAX_KOBO).default(0),
  otherCostKobo: z.number().int().min(0).max(MAX_KOBO).default(0),
  note: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((v) => v || null),
  // What was handed over now. Buying on credit — the market norm — leaves this 0.
  amountPaidKobo: z.number().int().min(0).max(MAX_KOBO).default(0),
  paymentMethod: z.enum(PURCHASE_PAYMENT_METHODS).default("CASH"),
  paymentReference: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((v) => v || null),
  lines: z.array(LineSchema).min(1, "Add at least one item to receive."),
});

export async function POST(request: Request) {
  return handle(async () => {
    const session = await requireTenantApi();
    requirePermission(session.user, PERMISSIONS.PURCHASES_MANAGE);
    const orgId = session.org.id;

    const input = CreateSchema.parse(await readJson(request));

    // ── Where the goods land ────────────────────────────────────────────────
    // A main admin may not be pinned to a branch, so the form can name one; a
    // cashier/storekeeper receives into the branch their session is tied to.
    const branchId = input.branchId ?? session.branch?.id ?? null;
    if (!branchId) {
      throw new AppError("Choose which branch is receiving these goods.", {
        status: 400,
        fields: { branch: "Pick a branch" },
      });
    }
    const branch = await prisma.branch.findFirst({
      where: { id: branchId, organizationId: orgId },
      select: { id: true },
    });
    if (!branch) {
      throw new AppError("That branch isn't on file.", {
        status: 422,
        fields: { branch: "Unknown branch" },
      });
    }

    // ── Who it came from ──────────────────────────────────────────────────────
    const supplier = await prisma.supplier.findFirst({
      where: { id: input.supplierId, organizationId: orgId },
      select: { id: true, isActive: true },
    });
    if (!supplier) {
      throw new AppError("That supplier isn't on file.", {
        status: 422,
        fields: { supplier: "Choose a supplier" },
      });
    }
    if (!supplier.isActive) {
      throw new AppError("That supplier has been deactivated. Reactivate them first.", {
        status: 422,
        fields: { supplier: "Supplier is inactive" },
      });
    }

    // ── The items, priced and verified against the catalogue ──────────────────
    const productIds = [...new Set(input.lines.map((l) => l.productId))];
    const products = await prisma.product.findMany({
      where: { organizationId: orgId, id: { in: productIds } },
      select: { id: true, supplierId: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    const lines = input.lines.map((line) => {
      const product = byId.get(line.productId);
      if (!product) {
        throw new AppError("A product on this delivery no longer exists. Refresh and try again.", {
          status: 422,
        });
      }
      const lineTotalKobo = Math.round(line.unitCostKobo * line.quantity);
      if (lineTotalKobo > MAX_KOBO) {
        throw new AppError("One line is too large to record — split it across entries.", {
          status: 422,
        });
      }
      return {
        productId: product.id,
        defaultSupplierId: product.supplierId,
        quantity: line.quantity,
        unitCostKobo: line.unitCostKobo,
        lineTotalKobo,
        batchNo: line.batchNo,
        expiryDate: line.expiryDate ?? null,
      };
    });

    // ── Totals: computed here, never trusted from the client ──────────────────
    const subtotalKobo = lines.reduce((sum, l) => sum + l.lineTotalKobo, 0);
    const totalKobo = subtotalKobo + input.transportKobo + input.otherCostKobo;
    if (totalKobo > MAX_KOBO) {
      throw new AppError("This purchase is too large to record in one entry — split it.", {
        status: 422,
      });
    }
    if (totalKobo <= 0) {
      throw new AppError("This purchase comes to nothing — add an item or a cost.", {
        status: 422,
      });
    }

    // ── Settlement ────────────────────────────────────────────────────────────
    const amountPaidKobo = input.amountPaidKobo;
    if (amountPaidKobo > totalKobo) {
      throw new AppError("You can't pay more than the purchase total.", {
        status: 422,
        fields: { amountPaid: "More than the total" },
      });
    }
    // Paying for goods is a separate trust from receiving them: a storekeeper
    // can book in a delivery without being allowed to move money.
    if (amountPaidKobo > 0) {
      requirePermission(session.user, PERMISSIONS.PURCHASES_PAY);
    }
    const balanceKobo = totalKobo - amountPaidKobo;
    const paymentStatus =
      amountPaidKobo <= 0 ? "UNPAID" : balanceKobo <= 0 ? "PAID" : "PARTIAL";

    // purchaseDate may be backdated (recording last week's delivery) but never
    // post-dated past the server clock, or it files into a day that hasn't come.
    const now = new Date();
    const requestedDate = input.purchaseDate ?? now;
    const purchaseDate = requestedDate.getTime() > now.getTime() ? now : requestedDate;

    // Latest paid cost wins as the product's standing cost; a zero-cost line
    // (free samples, a correction) must not wipe a real cost.
    const costUpdates = new Map<string, number>();
    for (const l of lines) {
      if (l.unitCostKobo > 0) costUpdates.set(l.productId, l.unitCostKobo);
    }

    const result = await prisma.$transaction(async (tx) => {
      const reference = await nextPurchaseNumber(tx, orgId);

      const purchase = await tx.purchase.create({
        data: {
          organizationId: orgId,
          branchId,
          supplierId: supplier.id,
          reference,
          invoiceNo: input.invoiceNo,
          purchaseDate,
          subtotalKobo,
          transportKobo: input.transportKobo,
          otherCostKobo: input.otherCostKobo,
          totalKobo,
          amountPaidKobo,
          balanceKobo,
          paymentStatus,
          status: "RECEIVED",
          note: input.note,
          createdById: session.user.id,
          items: {
            create: lines.map((l) => ({
              organizationId: orgId,
              productId: l.productId,
              quantity: l.quantity,
              unitCostKobo: l.unitCostKobo,
              lineTotalKobo: l.lineTotalKobo,
              batchNo: l.batchNo,
              expiryDate: l.expiryDate,
            })),
          },
        },
        select: { id: true, reference: true },
      });

      // Book each line into the stock ledger. Positive quantity — stock arriving.
      for (const l of lines) {
        await applyMovement(tx, {
          organizationId: orgId,
          branchId,
          productId: l.productId,
          quantity: l.quantity,
          type: "PURCHASE",
          unitCostKobo: l.unitCostKobo,
          referenceType: "PURCHASE",
          referenceId: purchase.id,
          userId: session.user.id,
          batch: { batchNo: l.batchNo ?? null, expiryDate: l.expiryDate ?? null, source: "PURCHASE" },
        });
      }

      // Standing cost, and a default source for products that didn't have one.
      for (const l of lines) {
        const newCost = costUpdates.get(l.productId);
        const setSupplier = l.defaultSupplierId ? undefined : supplier.id;
        if (newCost === undefined && setSupplier === undefined) continue;
        await tx.product.update({
          where: { id: l.productId },
          data: {
            ...(newCost === undefined ? {} : { costPriceKobo: newCost }),
            ...(setSupplier === undefined ? {} : { supplierId: setSupplier }),
          },
        });
      }

      // We now owe the supplier the unpaid remainder.
      if (balanceKobo > 0) {
        await tx.supplier.update({
          where: { id: supplier.id },
          data: { balanceKobo: { increment: balanceKobo } },
        });
      }

      // Record the cash-out so the money ledger and supplier history are complete.
      if (amountPaidKobo > 0) {
        await tx.payment.create({
          data: {
            organizationId: orgId,
            direction: "OUT",
            supplierId: supplier.id,
            purchaseId: purchase.id,
            amountKobo: amountPaidKobo,
            method: input.paymentMethod,
            reference: input.paymentReference,
            userId: session.user.id,
            paidAt: now,
          },
        });
      }

      return purchase;
    });

    return NextResponse.json(
      {
        ok: true,
        purchase: {
          id: result.id,
          reference: result.reference,
          totalKobo,
          balanceKobo,
          paymentStatus,
        },
      },
      { status: 201 },
    );
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/purchases — recent deliveries, newest first.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  return handle(async () => {
    const session = await requireTenantApi();
    requirePermission(session.user, PERMISSIONS.PURCHASES_VIEW);
    const orgId = session.org.id;

    const url = new URL(request.url);
    const supplierId = (url.searchParams.get("supplier") ?? "").trim() || null;
    const status = (url.searchParams.get("status") ?? "").trim() || null;
    const limitRaw = Number(url.searchParams.get("limit"));
    const take = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;

    const purchases = await prisma.purchase.findMany({
      where: {
        organizationId: orgId,
        ...(supplierId ? { supplierId } : {}),
        ...(status ? { paymentStatus: status } : {}),
      },
      orderBy: { purchaseDate: "desc" },
      take,
      select: {
        id: true,
        reference: true,
        invoiceNo: true,
        purchaseDate: true,
        totalKobo: true,
        amountPaidKobo: true,
        balanceKobo: true,
        paymentStatus: true,
        status: true,
        supplier: { select: { id: true, name: true } },
        branch: { select: { name: true, code: true } },
        _count: { select: { items: true } },
      },
    });

    const items = purchases.map((p) => ({
      id: p.id,
      reference: p.reference,
      invoiceNo: p.invoiceNo,
      purchaseDate: p.purchaseDate.toISOString(),
      totalKobo: p.totalKobo,
      amountPaidKobo: p.amountPaidKobo,
      balanceKobo: p.balanceKobo,
      paymentStatus: p.paymentStatus,
      status: p.status,
      supplierId: p.supplier.id,
      supplierName: p.supplier.name,
      branchName: p.branch.name,
      branchCode: p.branch.code,
      itemCount: p._count.items,
    }));

    return NextResponse.json({ items });
  });
}
