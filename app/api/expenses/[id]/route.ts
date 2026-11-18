import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError, handle, readJson } from "@/lib/api";
import { prisma } from "@/lib/db";
import { requireTenantApi } from "@/lib/auth";
import { requirePermission } from "@/lib/permissions";
import { PERMISSIONS, EXPENSE_CATEGORIES } from "@/lib/constants";

/**
 * A single expense — correct it, or remove it.
 *
 * Unlike a customer or a product, an expense is a leaf: nothing is tied to it, so
 * a mistyped amount is simply deleted, not deactivated. Hiding it would leave the
 * month's total wrong with no way to put it right. The guard that matters here is
 * tenancy — the id in the URL is checked against the org before any write.
 */

const MAX_KOBO = 2_000_000_000;
const EXPENSE_METHODS = ["CASH", "TRANSFER", "POS", "CHEQUE"] as const;

const emptyToNull = (v: unknown) =>
  v === "" || v === null || v === undefined ? null : v;

const UpdateSchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES),
  amountKobo: z
    .number()
    .int()
    .positive("Enter how much you spent.")
    .max(MAX_KOBO, "That amount is too large."),
  description: z.string().trim().max(300).optional().transform((v) => v || null),
  vendor: z.string().trim().max(160).optional().transform((v) => v || null),
  paymentMethod: z.enum(EXPENSE_METHODS).default("CASH"),
  branchId: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || null),
  expenseDate: z.preprocess(emptyToNull, z.coerce.date().nullable()).optional(),
});

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = await requireTenantApi();
    requirePermission(session.user, PERMISSIONS.EXPENSES_MANAGE);
    const orgId = session.org.id;

    const { id } = await params;
    const input = UpdateSchema.parse(await readJson(request));

    const existing = await prisma.expense.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true },
    });
    if (!existing) throw new AppError("That expense no longer exists.", { status: 404 });

    if (input.branchId) {
      const branch = await prisma.branch.findFirst({
        where: { id: input.branchId, organizationId: orgId },
        select: { id: true },
      });
      if (!branch) {
        throw new AppError("That branch no longer exists.", {
          status: 422,
          fields: { branchId: "Unknown branch" },
        });
      }
    }

    const now = new Date();
    const requested = input.expenseDate ?? now;
    const expenseDate = requested.getTime() > now.getTime() ? now : requested;

    await prisma.expense.update({
      where: { id },
      data: {
        branchId: input.branchId,
        category: input.category,
        amountKobo: input.amountKobo,
        description: input.description,
        vendor: input.vendor,
        paymentMethod: input.paymentMethod,
        expenseDate,
      },
    });

    return NextResponse.json({ ok: true });
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = await requireTenantApi();
    requirePermission(session.user, PERMISSIONS.EXPENSES_MANAGE);

    const { id } = await params;

    const existing = await prisma.expense.findFirst({
      where: { id, organizationId: session.org.id },
      select: { id: true },
    });
    if (!existing) throw new AppError("That expense no longer exists.", { status: 404 });

    await prisma.expense.delete({ where: { id } });

    return NextResponse.json({ ok: true });
  });
}
