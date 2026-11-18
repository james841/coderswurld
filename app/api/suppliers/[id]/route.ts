import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError, handle, readJson } from "@/lib/api";
import { prisma } from "@/lib/db";
import { requireTenantApi } from "@/lib/auth";
import { requirePermission } from "@/lib/permissions";
import { PERMISSIONS, SUPPLIER_TYPE_LABELS } from "@/lib/constants";

/**
 * A single supplier — edit, or take out of circulation.
 *
 * There is no hard delete. A supplier is the answer to "where did this stock come
 * from", recorded on every past purchase and on the products that still point at
 * it; deleting the row would blank out that history. So "remove" means
 * `isActive = false`: it drops out of the pickers and the default list, and the
 * trail it is part of stays intact. Reactivating is the same PUT with the switch
 * back on.
 */

const SUPPLIER_TYPES = Object.keys(SUPPLIER_TYPE_LABELS) as [string, ...string[]];

const UpdateSchema = z.object({
  name: z.string().trim().min(2, "Give the supplier a name.").max(160),
  type: z.enum(SUPPLIER_TYPES),
  marketName: z.string().trim().max(120).optional().transform((v) => v || null),
  location: z.string().trim().max(120).optional().transform((v) => v || null),
  address: z.string().trim().max(240).optional().transform((v) => v || null),
  contactPerson: z.string().trim().max(120).optional().transform((v) => v || null),
  phone: z.string().trim().max(40).optional().transform((v) => v || null),
  whatsapp: z.string().trim().max(40).optional().transform((v) => v || null),
  email: z.string().trim().max(160).optional().transform((v) => v || null),
  notes: z.string().trim().max(2000).optional().transform((v) => v || null),
  isActive: z.boolean().optional(),
});

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = await requireTenantApi();
    requirePermission(session.user, PERMISSIONS.SUPPLIERS_MANAGE);

    const { id } = await params;
    const input = UpdateSchema.parse(await readJson(request));

    // Scope the existence check to the org before touching anything: ids are
    // cuids, not secrets, and this is the shape of query that leaks across
    // tenants the day someone trusts the id in the URL.
    const existing = await prisma.supplier.findFirst({
      where: { id, organizationId: session.org.id },
      select: { id: true },
    });
    if (!existing) throw new AppError("That supplier no longer exists.", { status: 404 });

    const clash = await prisma.supplier.findFirst({
      where: {
        organizationId: session.org.id,
        name: { equals: input.name, mode: "insensitive" },
        NOT: { id },
      },
      select: { name: true },
    });
    if (clash) {
      throw new AppError(`You already have a supplier called "${clash.name}".`, {
        status: 409,
        fields: { name: "Already exists" },
      });
    }

    const supplier = await prisma.supplier.update({
      where: { id },
      data: {
        name: input.name,
        type: input.type,
        marketName: input.marketName,
        location: input.location,
        address: input.address,
        contactPerson: input.contactPerson,
        phone: input.phone,
        whatsapp: input.whatsapp,
        email: input.email,
        notes: input.notes,
        ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      },
      select: { id: true, name: true, isActive: true },
    });

    return NextResponse.json({ ok: true, supplier });
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = await requireTenantApi();
    requirePermission(session.user, PERMISSIONS.SUPPLIERS_MANAGE);

    const { id } = await params;

    const existing = await prisma.supplier.findFirst({
      where: { id, organizationId: session.org.id },
      select: { id: true },
    });
    if (!existing) throw new AppError("That supplier no longer exists.", { status: 404 });

    // Soft delete — see the file header for why the row must stay.
    await prisma.supplier.update({ where: { id }, data: { isActive: false } });

    return NextResponse.json({ ok: true });
  });
}
