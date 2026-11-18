import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError, handle, readJson } from "@/lib/api";
import { prisma } from "@/lib/db";
import { requireTenantApi } from "@/lib/auth";
import { requirePermission } from "@/lib/permissions";
import { PERMISSIONS, SUPPLIER_TYPE_LABELS } from "@/lib/constants";

/**
 * Suppliers and the markets a shop actually buys from.
 *
 * "Where did we buy it?" was an explicit requirement, and in the Nigerian market
 * the honest answer is often a stall at Mile 12, not a company with an invoice.
 * So a supplier carries a `marketName` and `location` alongside the formal
 * fields, and `type` says which kind it is. Every product can point at one, and
 * that is what makes "show me everything we got from Trade Fair" answerable.
 *
 * No catalog bump here: suppliers never reach the till. They belong to buying and
 * reporting, which read from the server, not from the offline catalog.
 */

const SUPPLIER_TYPES = Object.keys(SUPPLIER_TYPE_LABELS) as [string, ...string[]];

const CreateSchema = z.object({
  name: z.string().trim().min(2, "Give the supplier a name.").max(160),
  type: z.enum(SUPPLIER_TYPES).default("MARKET"),
  marketName: z.string().trim().max(120).optional().transform((v) => v || null),
  location: z.string().trim().max(120).optional().transform((v) => v || null),
  address: z.string().trim().max(240).optional().transform((v) => v || null),
  contactPerson: z.string().trim().max(120).optional().transform((v) => v || null),
  phone: z.string().trim().max(40).optional().transform((v) => v || null),
  whatsapp: z.string().trim().max(40).optional().transform((v) => v || null),
  email: z.string().trim().max(160).optional().transform((v) => v || null),
  notes: z.string().trim().max(2000).optional().transform((v) => v || null),
});

export async function GET(request: Request) {
  return handle(async () => {
    const session = await requireTenantApi();
    requirePermission(session.user, PERMISSIONS.SUPPLIERS_VIEW);

    const url = new URL(request.url);
    const q = url.searchParams.get("q")?.trim();
    const includeInactive = url.searchParams.get("includeInactive") === "true";

    const suppliers = await prisma.supplier.findMany({
      where: {
        organizationId: session.org.id,
        ...(includeInactive ? {} : { isActive: true }),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { marketName: { contains: q, mode: "insensitive" } },
                { location: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: [{ name: "asc" }],
      select: {
        id: true,
        name: true,
        type: true,
        marketName: true,
        location: true,
        phone: true,
        whatsapp: true,
        balanceKobo: true,
        isActive: true,
        _count: { select: { products: true } },
      },
    });

    return NextResponse.json({
      items: suppliers.map((s) => ({
        id: s.id,
        name: s.name,
        type: s.type,
        marketName: s.marketName,
        location: s.location,
        phone: s.phone,
        whatsapp: s.whatsapp,
        balanceKobo: s.balanceKobo,
        isActive: s.isActive,
        productCount: s._count.products,
      })),
    });
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const session = await requireTenantApi();
    requirePermission(session.user, PERMISSIONS.SUPPLIERS_MANAGE);

    const input = CreateSchema.parse(await readJson(request));

    const clash = await prisma.supplier.findFirst({
      where: { organizationId: session.org.id, name: { equals: input.name, mode: "insensitive" } },
      select: { id: true, name: true },
    });
    if (clash) {
      throw new AppError(`You already have a supplier called "${clash.name}".`, {
        status: 409,
        fields: { name: "Already exists" },
      });
    }

    const supplier = await prisma.supplier.create({
      data: {
        organizationId: session.org.id,
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
      },
      select: { id: true, name: true, type: true, marketName: true, location: true },
    });

    return NextResponse.json({ ok: true, supplier }, { status: 201 });
  });
}
