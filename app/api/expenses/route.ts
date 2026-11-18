import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError, handle, readJson } from "@/lib/api";
import { prisma } from "@/lib/db";
import { requireTenantApi } from "@/lib/auth";
import { requirePermission } from "@/lib/permissions";
import { PERMISSIONS, EXPENSE_CATEGORIES } from "@/lib/constants";
import { monthRange } from "@/lib/dates";

/**
 * Expenses — the money going out that isn't stock.
 *
 * Rent, fuel for the generator, the boy who helps offload the truck, NEPA, the
 * local-government levy. A shop can look busy and still lose money, and this is
 * half of the answer to "where did it go": sales on one side, these on the
 * other. Each row is one payment the owner made to keep the doors open, bucketed
 * by a plain category so the month adds up without an accountant.
 *
 * Not a ledger of debts — an expense is already paid when you write it down. The
 * amount is money that left the business, full stop; there's no balance to carry.
 */

const MAX_KOBO = 2_000_000_000;

// How a bill gets paid. Narrower than a sale (no "on credit" — you don't owe
// yourself) and includes cheque, which suppliers and landlords still use.
const EXPENSE_METHODS = ["CASH", "TRANSFER", "POS", "CHEQUE"] as const;

const emptyToNull = (v: unknown) =>
  v === "" || v === null || v === undefined ? null : v;

const CreateSchema = z.object({
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
  // Backdating is fine — you forgot to log yesterday's transport. Future isn't:
  // you can't have spent money tomorrow. The route clamps that below.
  expenseDate: z.preprocess(emptyToNull, z.coerce.date().nullable()).optional(),
});

export async function GET(request: Request) {
  return handle(async () => {
    const session = await requireTenantApi();
    requirePermission(session.user, PERMISSIONS.EXPENSES_VIEW);

    const url = new URL(request.url);
    const monthParam = url.searchParams.get("month"); // "YYYY-MM"
    const category = url.searchParams.get("category")?.trim();
    const branchId = url.searchParams.get("branchId")?.trim();

    // A specific month if asked for and well-formed, otherwise the current one.
    const anchor = parseMonthAnchor(monthParam);
    const { start, end } = monthRange(anchor, session.org.timezone);

    const where = {
      organizationId: session.org.id,
      expenseDate: { gte: start, lt: end },
      ...(category ? { category } : {}),
      ...(branchId ? { branchId } : {}),
    };

    const items = await prisma.expense.findMany({
      where,
      orderBy: { expenseDate: "desc" },
      select: {
        id: true,
        category: true,
        amountKobo: true,
        description: true,
        vendor: true,
        paymentMethod: true,
        expenseDate: true,
        branchId: true,
      },
    });

    const totalKobo = items.reduce((sum, e) => sum + e.amountKobo, 0);

    return NextResponse.json({ items, totalKobo });
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const session = await requireTenantApi();
    requirePermission(session.user, PERMISSIONS.EXPENSES_MANAGE);
    const orgId = session.org.id;

    const input = CreateSchema.parse(await readJson(request));

    // A branch id in the body is trusted input — make sure it's ours before we
    // stamp it onto a row, or one tenant could file costs against another's shop.
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

    const expense = await prisma.expense.create({
      data: {
        organizationId: orgId,
        branchId: input.branchId,
        category: input.category,
        amountKobo: input.amountKobo,
        description: input.description,
        vendor: input.vendor,
        paymentMethod: input.paymentMethod,
        expenseDate,
        userId: session.user.id,
      },
      select: { id: true },
    });

    return NextResponse.json({ ok: true, expense }, { status: 201 });
  });
}

/**
 * A `Date` sitting safely inside the requested month, for `monthRange` to pin to
 * the org's zone. Mid-month at noon UTC can't slip into a neighbouring month in
 * any timezone. Anything malformed falls back to now.
 */
function parseMonthAnchor(month: string | null): Date {
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const [y, m] = month.split("-").map(Number);
    if (m >= 1 && m <= 12) return new Date(Date.UTC(y, m - 1, 15, 12));
  }
  return new Date();
}
