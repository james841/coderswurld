import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError, handle, readJson } from "@/lib/api";
import { prisma } from "@/lib/db";
import { requireTenantApi } from "@/lib/auth";
import { requirePermission } from "@/lib/permissions";
import { PERMISSIONS } from "@/lib/constants";

/**
 * POST /api/customers/[id]/pay — a customer pays down what they owe.
 *
 * Selling on credit and collecting later — "I'll pay you Friday" — is the norm
 * this supports. A repayment moves two figures that must never drift apart, so
 * both change in one transaction: the customer's outstanding balance drops, and
 * an IN row lands in the cash ledger. The payment isn't tied to one sale; it pays
 * down the running account, the same way a market trader clears your tab.
 */

const MAX_KOBO = 2_000_000_000;
const PAYMENT_METHODS = ["CASH", "TRANSFER", "POS", "CHEQUE"] as const;

const emptyToNull = (v: unknown) =>
  v === "" || v === null || v === undefined ? null : v;

const PaySchema = z.object({
  amountKobo: z
    .number()
    .int()
    .positive("Enter how much they paid.")
    .max(MAX_KOBO, "That amount is too large."),
  method: z.enum(PAYMENT_METHODS).default("CASH"),
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
    requirePermission(session.user, PERMISSIONS.CUSTOMERS_DEBT);
    const orgId = session.org.id;

    const { id } = await params;
    const input = PaySchema.parse(await readJson(request));

    const customer = await prisma.customer.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, balanceKobo: true },
    });
    if (!customer) throw new AppError("That customer no longer exists.", { status: 404 });

    if (customer.balanceKobo <= 0) {
      throw new AppError("This customer doesn't owe anything.", { status: 422 });
    }
    if (input.amountKobo > customer.balanceKobo) {
      throw new AppError("That's more than they owe.", {
        status: 422,
        fields: { amount: "More than what's owed" },
      });
    }

    const newBalance = customer.balanceKobo - input.amountKobo;

    // Never post-date a payment: a "paid Friday" dated next month would throw off
    // every report that buckets money by day. Clamp a future date back to now.
    const now = new Date();
    const requested = input.paidAt ?? now;
    const paidAt = requested.getTime() > now.getTime() ? now : requested;

    await prisma.$transaction(async (tx) => {
      await tx.customer.update({
        where: { id: customer.id },
        data: { balanceKobo: newBalance },
      });

      await tx.payment.create({
        data: {
          organizationId: orgId,
          direction: "IN",
          customerId: customer.id,
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
      customer: { id: customer.id, balanceKobo: newBalance },
    });
  });
}
