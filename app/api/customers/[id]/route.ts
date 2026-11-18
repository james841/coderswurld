import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError, handle, readJson } from "@/lib/api";
import { prisma } from "@/lib/db";
import { requireTenantApi } from "@/lib/auth";
import { requirePermission } from "@/lib/permissions";
import { PERMISSIONS } from "@/lib/constants";

/**
 * A single customer — edit, or take off the active list.
 *
 * No hard delete. A customer is tied to every sale they've ever made and to the
 * debt they may still owe; deleting the row would orphan that history and quietly
 * erase money owed. "Remove" means `isActive = false`: they drop out of the till's
 * customer picker and the default list, while the trail stays intact. Reactivating
 * is the same PUT with the switch back on.
 */

const MAX_KOBO = 2_000_000_000;

const UpdateSchema = z.object({
  name: z.string().trim().min(2, "Give the customer a name.").max(160),
  phone: z.string().trim().max(40).optional().transform((v) => v || null),
  whatsapp: z.string().trim().max(40).optional().transform((v) => v || null),
  email: z.string().trim().max(160).optional().transform((v) => v || null),
  address: z.string().trim().max(240).optional().transform((v) => v || null),
  notes: z.string().trim().max(2000).optional().transform((v) => v || null),
  creditLimitKobo: z.number().int().min(0).max(MAX_KOBO).optional().default(0),
  isActive: z.boolean().optional(),
});

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = await requireTenantApi();
    requirePermission(session.user, PERMISSIONS.CUSTOMERS_MANAGE);

    const { id } = await params;
    const input = UpdateSchema.parse(await readJson(request));

    // Scope the existence check to the org before touching anything: ids are
    // cuids, not secrets, and a trusted id in the URL is how data leaks across
    // tenants.
    const existing = await prisma.customer.findFirst({
      where: { id, organizationId: session.org.id },
      select: { id: true },
    });
    if (!existing) throw new AppError("That customer no longer exists.", { status: 404 });

    const clash = await prisma.customer.findFirst({
      where: {
        organizationId: session.org.id,
        name: { equals: input.name, mode: "insensitive" },
        NOT: { id },
      },
      select: { name: true },
    });
    if (clash) {
      throw new AppError(`You already have a customer called "${clash.name}".`, {
        status: 409,
        fields: { name: "Already exists" },
      });
    }

    const customer = await prisma.customer.update({
      where: { id },
      data: {
        name: input.name,
        phone: input.phone,
        whatsapp: input.whatsapp,
        email: input.email,
        address: input.address,
        notes: input.notes,
        creditLimitKobo: input.creditLimitKobo,
        ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      },
      select: { id: true, name: true, isActive: true },
    });

    return NextResponse.json({ ok: true, customer });
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = await requireTenantApi();
    requirePermission(session.user, PERMISSIONS.CUSTOMERS_MANAGE);

    const { id } = await params;

    const existing = await prisma.customer.findFirst({
      where: { id, organizationId: session.org.id },
      select: { id: true },
    });
    if (!existing) throw new AppError("That customer no longer exists.", { status: 404 });

    // Soft delete — see the file header for why the row must stay.
    await prisma.customer.update({ where: { id }, data: { isActive: false } });

    return NextResponse.json({ ok: true });
  });
}
