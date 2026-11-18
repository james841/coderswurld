import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError, handle, readJson } from "@/lib/api";
import { prisma } from "@/lib/db";
import { requireTenantApi } from "@/lib/auth";
import { requirePermission } from "@/lib/permissions";
import { PERMISSIONS } from "@/lib/constants";
import { applyMovement } from "@/lib/stock";

/**
 * POST /api/sales/[id]/void — reverse a completed sale, in full.
 *
 * The counterpart to recording a sale: a cashier rang up the wrong thing, or the
 * customer walked away before paying. Voiding has to undo everything the sale
 * did, in one transaction, or it leaves the shop worse off than an honest
 * mistake — stock that never came back, a customer still shown as owing for
 * goods they returned.
 *
 * Three things get reversed together:
 *   1. STOCK. Every line goes back on the shelf as a RETURN movement against the
 *      sale's own branch. A line whose product was since deleted can't be
 *      restocked — there's no shelf to put it on — so it's skipped, but the
 *      money reversal below still happens.
 *   2. THE CUSTOMER LEDGER. If the sale was put to a customer, its contribution
 *      to their debt and lifetime spend is taken back, and their purchase count
 *      drops by one. All three are clamped at zero: a sale that was partly repaid
 *      before being voided must never drive a balance negative.
 *   3. THE SALE ITSELF. Marked VOIDED with the reason, so the receipt and every
 *      report can see it was reversed rather than silently vanish.
 *
 * It is not idempotent by key like the sale write, but it doesn't need to be: a
 * sale can only leave COMPLETED once, and a second attempt is refused because the
 * status no longer matches. Partial refunds — returning some lines, not all —
 * are a separate flow; this is the whole-sale reversal.
 */

const VoidSchema = z.object({
  reason: z
    .string()
    .trim()
    .max(300, "Keep the reason short.")
    .optional()
    .transform((v) => v || null),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = await requireTenantApi();
    requirePermission(session.user, PERMISSIONS.SALES_VOID);
    const orgId = session.org.id;

    const { id } = await params;
    const { reason } = VoidSchema.parse(await readJson(request));

    const sale = await prisma.sale.findFirst({
      where: { id, organizationId: orgId },
      select: {
        id: true,
        branchId: true,
        status: true,
        customerId: true,
        totalKobo: true,
        balanceKobo: true,
        items: {
          select: { productId: true, quantity: true, unitCostKobo: true },
        },
      },
    });

    if (!sale) throw new AppError("That sale no longer exists.", { status: 404 });

    // Only a completed sale can be voided. A second attempt, or trying to void an
    // already-refunded one, lands here and is refused rather than double-reversing.
    if (sale.status !== "COMPLETED") {
      throw new AppError("This sale has already been voided or refunded.", { status: 409 });
    }

    await prisma.$transaction(async (tx) => {
      // 1. Put the stock back, line by line, against the branch that sold it.
      for (const item of sale.items) {
        if (!item.productId) continue; // product deleted — nothing to restock
        await applyMovement(
          tx,
          {
            organizationId: orgId,
            branchId: sale.branchId,
            productId: item.productId,
            quantity: item.quantity, // positive: stock returning to the shelf
            type: "RETURN",
            unitCostKobo: item.unitCostKobo,
            referenceType: "SALE_VOID",
            referenceId: sale.id,
            reason: "Sale voided",
            userId: session.user.id,
          },
          // Adding stock back can't go below zero, but a prior oversell could have
          // left the level negative — allow it through rather than block the void.
          { allowNegative: true },
        );
      }

      // 2. Unwind this sale's mark on the customer, never past zero.
      if (sale.customerId) {
        const customer = await tx.customer.findUnique({
          where: { id: sale.customerId },
          select: { balanceKobo: true, totalSpentKobo: true, purchaseCount: true },
        });
        if (customer) {
          await tx.customer.update({
            where: { id: sale.customerId },
            data: {
              balanceKobo: Math.max(0, customer.balanceKobo - sale.balanceKobo),
              totalSpentKobo: Math.max(0, customer.totalSpentKobo - sale.totalKobo),
              purchaseCount: Math.max(0, customer.purchaseCount - 1),
            },
          });
        }
      }

      // 3. Record the reversal on the sale itself.
      await tx.sale.update({
        where: { id: sale.id },
        data: { status: "VOIDED", voidedReason: reason },
      });
    });

    return NextResponse.json({ ok: true });
  });
}
