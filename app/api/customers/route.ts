import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError, handle, readJson } from "@/lib/api";
import { prisma } from "@/lib/db";
import { requireTenantApi } from "@/lib/auth";
import { requirePermission } from "@/lib/permissions";
import { PERMISSIONS } from "@/lib/constants";

/**
 * Customers — the people a shop sells to, and the debts they carry.
 *
 * Most sales are to a walk-in nobody writes down. A customer row exists for the
 * ones worth remembering: the regulars, and above all anyone who buys on credit.
 * The balance a customer owes is never typed in on this route — it is the sum of
 * their credit sales minus what they've paid back, so every naira of debt traces
 * to a real sale. This is just the contact book; the till and the repayment route
 * are what move the money.
 *
 * No catalog bump: customers never reach the offline till. They belong to selling
 * and reporting, which read from the server.
 */

const MAX_KOBO = 2_000_000_000;

const CreateSchema = z.object({
  name: z.string().trim().min(2, "Give the customer a name.").max(160),
  phone: z.string().trim().max(40).optional().transform((v) => v || null),
  whatsapp: z.string().trim().max(40).optional().transform((v) => v || null),
  email: z.string().trim().max(160).optional().transform((v) => v || null),
  address: z.string().trim().max(240).optional().transform((v) => v || null),
  notes: z.string().trim().max(2000).optional().transform((v) => v || null),
  // The most you'll let them owe at once. 0 means no limit set.
  creditLimitKobo: z.number().int().min(0).max(MAX_KOBO).optional().default(0),
});

export async function GET(request: Request) {
  return handle(async () => {
    const session = await requireTenantApi();
    requirePermission(session.user, PERMISSIONS.CUSTOMERS_VIEW);

    const url = new URL(request.url);
    const q = url.searchParams.get("q")?.trim();
    const includeInactive = url.searchParams.get("includeInactive") === "true";

    const customers = await prisma.customer.findMany({
      where: {
        organizationId: session.org.id,
        ...(includeInactive ? {} : { isActive: true }),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { phone: { contains: q } },
                { whatsapp: { contains: q } },
              ],
            }
          : {}),
      },
      orderBy: [{ name: "asc" }],
      select: {
        id: true,
        name: true,
        phone: true,
        whatsapp: true,
        balanceKobo: true,
        creditLimitKobo: true,
        totalSpentKobo: true,
        isActive: true,
      },
    });

    return NextResponse.json({ items: customers });
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const session = await requireTenantApi();
    requirePermission(session.user, PERMISSIONS.CUSTOMERS_MANAGE);

    const input = CreateSchema.parse(await readJson(request));

    const clash = await prisma.customer.findFirst({
      where: { organizationId: session.org.id, name: { equals: input.name, mode: "insensitive" } },
      select: { id: true, name: true },
    });
    if (clash) {
      throw new AppError(`You already have a customer called "${clash.name}".`, {
        status: 409,
        fields: { name: "Already exists" },
      });
    }

    const customer = await prisma.customer.create({
      data: {
        organizationId: session.org.id,
        name: input.name,
        phone: input.phone,
        whatsapp: input.whatsapp,
        email: input.email,
        address: input.address,
        notes: input.notes,
        creditLimitKobo: input.creditLimitKobo,
      },
      select: { id: true, name: true },
    });

    return NextResponse.json({ ok: true, customer }, { status: 201 });
  });
}
