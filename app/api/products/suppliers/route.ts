import { NextResponse } from "next/server";
import { z } from "zod";

import { handle, readJson } from "@/lib/api";
import { prisma } from "@/lib/db";
import { requireTenantApi } from "@/lib/auth";
import { requirePermission } from "@/lib/permissions";
import { PERMISSIONS } from "@/lib/constants";

/**
 * POST /api/products/suppliers — find-or-create a supplier by name.
 *
 * The product form asks "where were these goods bought?" and this is how a name
 * that isn't in the list yet gets added without leaving the form. Same
 * find-or-create contract as the categories route: a case-insensitive match
 * returns the existing row rather than a 409, because from the form both answers
 * mean the same thing — there is now an id to attach.
 *
 * Gated on SUPPLIERS_MANAGE, not the product permissions. A supplier carries
 * money owed, a phone number and a market stall; creating one is a supplier
 * decision, not a product detail, and the two are granted separately.
 *
 * New suppliers default to type MARKET — the Nigerian buying trip the whole
 * "place goods were bought" feature is modelled on. The suppliers screen can
 * reclassify them later.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const session = await requireTenantApi();
    requirePermission(session.user, PERMISSIONS.SUPPLIERS_MANAGE);

    const { name } = BodySchema.parse(await readJson(request));

    const existing = await prisma.supplier.findFirst({
      where: { organizationId: session.org.id, name: { equals: name, mode: "insensitive" } },
      select: { id: true, name: true },
    });
    if (existing) {
      return NextResponse.json({ supplier: existing });
    }

    try {
      const created = await prisma.supplier.create({
        data: { organizationId: session.org.id, name, type: "MARKET" },
        select: { id: true, name: true },
      });
      return NextResponse.json({ supplier: created }, { status: 201 });
    } catch (error) {
      const raced = await prisma.supplier.findFirst({
        where: { organizationId: session.org.id, name: { equals: name, mode: "insensitive" } },
        select: { id: true, name: true },
      });
      if (raced) return NextResponse.json({ supplier: raced });
      throw error;
    }
  });
}

const BodySchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Give the supplier a name.")
    .max(120, "Keep it under 120 characters."),
});
