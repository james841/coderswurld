import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError, handle, readJson } from "@/lib/api";
import { prisma } from "@/lib/db";
import { requireTenantApi } from "@/lib/auth";
import { requirePermission } from "@/lib/permissions";
import { PERMISSIONS } from "@/lib/constants";

/**
 * POST /api/purchases/[id]/pay — settle part or all of what's owed on a delivery.
 *
 * Buying on credit from the market and paying it down later is the norm this
 * supports. One payment touches three figures and they must never drift apart,
 * so all three move in one transaction: the purchase's running paid/balance, the
 * supplier's outstanding balance, and a `Payment` row in the cash ledger.
 */

const MAX_KOBO = 2_000_000_000;
const PURCHASE_PAYMENT_METHODS = ["CASH", "TRANSFER", "POS", "CHEQUE"] as const;

const emptyToNull = (v: unknown) =>
  v === "" || v === null || v === undefined ? null : v;

const PaySchema = z.object({
  amountKobo: z
    .number()
    .int()
    .positive("Enter how much you paid.")
    .max(MAX_KOBO, "That amount is too large."),
  method: z.enum(PURCHASE_PAYMENT_METHODS).default("CASH"),
  reference: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((v) => v || null),
  note: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => v || null),
  paidAt: z.preprocess(emptyToNull, z.coerce.date().nullable()).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = await requireTenantApi();
    requirePermission(session.user, PERMISSIONS.PURCHASES_PAY);
    const orgId = session.org.id;

    const { id } = await params;
    const input = PaySchema.parse(await readJson(request));

    const purchase = await prisma.purchase.findFirst({
      where: { id, organizationId: orgId },
      select: {
        id: true,
        supplierId: true,
        totalKobo: true,
        amountPaidKobo: true,
        balanceKobo: true,
        status: true,
      },
    });
    if (!purchase) throw new AppError("That purchase no longer exists.", { status: 404 });

    if (purchase.status === "CANCELLED") {
      throw new AppError("This purchase was cancelled, so there's nothing to pay.", {
        status: 422,
      });
    }
    if (purchase.balanceKobo <= 0) {
      throw new AppError("This purchase is already fully paid.", { status: 422 });
    }
    if (input.amountKobo > purchase.balanceKobo) {
      throw new AppError("That's more than the outstanding balance.", {
        status: 422,
        fields: { amount: "More than what's owed" },
      });
    }

    const newPaid = purchase.amountPaidKobo + input.amountKobo;
    const newBalance = purchase.totalKobo - newPaid;
    const newStatus = newBalance <= 0 ? "PAID" : "PARTIAL";

    const now = new Date();
    const requested = input.paidAt ?? now;
    const paidAt = requested.getTime() > now.getTime() ? now : requested;

    await prisma.$transaction(async (tx) => {
      await tx.purchase.update({
        where: { id: purchase.id },
        data: {
          amountPaidKobo: newPaid,
          balanceKobo: newBalance,
          paymentStatus: newStatus,
        },
      });

      await tx.supplier.update({
        where: { id: purchase.supplierId },
        data: { balanceKobo: { decrement: input.amountKobo } },
      });

      await tx.payment.create({
        data: {
          organizationId: orgId,
          direction: "OUT",
          supplierId: purchase.supplierId,
          purchaseId: purchase.id,
          amountKobo: input.amountKobo,
          method: input.method,
          reference: input.reference,
          note: input.note,
          userId: session.user.id,
          paidAt,
        },
      });
    });

    return NextResponse.json({
      ok: true,
      purchase: {
        id: purchase.id,
        amountPaidKobo: newPaid,
        balanceKobo: newBalance,
        paymentStatus: newStatus,
      },
    });
  });
}
