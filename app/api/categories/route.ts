import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError, handle, readJson } from "@/lib/api";
import { prisma } from "@/lib/db";
import { requireTenantApi } from "@/lib/auth";
import { requirePermission } from "@/lib/permissions";
import { PERMISSIONS } from "@/lib/constants";
import { bumpCatalogVersion } from "@/lib/catalog";

/**
 * Categories — the POS category chips and the product-list filter.
 *
 * GET is part of viewing the catalog; POST adds structure to it, so it sits
 * behind the same permission as adding a product. The list carries a product
 * count because the first question anyone asks of a category screen is "how many
 * are in each", and computing it client-side would mean shipping every product.
 */

const CreateSchema = z.object({
  name: z.string().trim().min(1, "Give the category a name.").max(80),
  color: z
    .string()
    .trim()
    .regex(/^#([0-9a-fA-F]{6})$/, "Use a hex colour like #C2410C.")
    .optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
});

export async function GET() {
  return handle(async () => {
    const session = await requireTenantApi();
    requirePermission(session.user, PERMISSIONS.PRODUCTS_VIEW);

    const categories = await prisma.category.findMany({
      where: { organizationId: session.org.id },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        color: true,
        sortOrder: true,
        isActive: true,
        _count: { select: { products: true } },
      },
    });

    return NextResponse.json({
      items: categories.map((c) => ({
        id: c.id,
        name: c.name,
        color: c.color,
        sortOrder: c.sortOrder,
        isActive: c.isActive,
        productCount: c._count.products,
      })),
    });
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const session = await requireTenantApi();
    requirePermission(session.user, PERMISSIONS.PRODUCTS_CREATE);

    const input = CreateSchema.parse(await readJson(request));

    // A friendlier message than the raw unique-constraint 409. The DB index on
    // [organizationId, name] is still the real guard if two people add the same
    // category at once.
    const clash = await prisma.category.findFirst({
      where: { organizationId: session.org.id, name: { equals: input.name, mode: "insensitive" } },
      select: { id: true, name: true },
    });
    if (clash) {
      throw new AppError(`You already have a category called "${clash.name}".`, {
        status: 409,
        fields: { name: "Already exists" },
      });
    }

    const category = await prisma.$transaction(async (tx) => {
      const created = await tx.category.create({
        data: {
          organizationId: session.org.id,
          name: input.name,
          color: input.color ?? null,
          sortOrder: input.sortOrder,
        },
        select: { id: true, name: true, color: true, sortOrder: true },
      });
      // The till renders category chips, so a new category is a catalog change.
      await bumpCatalogVersion(session.org.id, tx);
      return created;
    });

    return NextResponse.json({ ok: true, category }, { status: 201 });
  });
}
