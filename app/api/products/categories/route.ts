import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError, handle, readJson } from "@/lib/api";
import { prisma } from "@/lib/db";
import { requireTenantApi } from "@/lib/auth";
import { hasAnyPermission } from "@/lib/permissions";
import { PERMISSIONS } from "@/lib/constants";

/**
 * POST /api/products/categories — find-or-create a category by name.
 *
 * The product form's "New category" box points at this. Two things make it
 * different from a plain create:
 *
 * 1. It is *find-or-create*. Typing "Drinks" when Drinks already exists is the
 *    most likely way to reach it, and handing back the existing row is the only
 *    answer that isn't a dead end. Matching is case-insensitive so "drinks" and
 *    "Drinks" don't fork the catalog into two categories nobody can tell apart.
 *
 * 2. It accepts either create OR edit permission. A category is a property of a
 *    product, so anyone allowed to change a product's detail page is allowed to
 *    name its category; gating this on PRODUCTS_CREATE alone would lock a
 *    manager who can edit products out of classifying them.
 *
 * Returns the existing row on a name clash rather than a 409, and mostly 200
 * rather than 201 — from the form's point of view the category exists either
 * way, and it only wants `{ id, name }` to put in the select.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const session = await requireTenantApi();

    if (
      !hasAnyPermission(session.user, [
        PERMISSIONS.PRODUCTS_CREATE,
        PERMISSIONS.PRODUCTS_EDIT,
      ])
    ) {
      throw new AppError("You don't have permission to add categories.", {
        status: 403,
      });
    }

    const { name } = BodySchema.parse(await readJson(request));

    const existing = await prisma.category.findFirst({
      where: { organizationId: session.org.id, name: { equals: name, mode: "insensitive" } },
      select: { id: true, name: true },
    });
    if (existing) {
      return NextResponse.json({ category: existing });
    }

    try {
      const created = await prisma.category.create({
        data: { organizationId: session.org.id, name },
        select: { id: true, name: true },
      });
      return NextResponse.json({ category: created }, { status: 201 });
    } catch (error) {
      // A unique index on (organizationId, name) can still fire if two quick
      // adds race past the lookup above. That isn't an error to show the person
      // — the category they wanted now exists, so hand it back.
      const raced = await prisma.category.findFirst({
        where: { organizationId: session.org.id, name: { equals: name, mode: "insensitive" } },
        select: { id: true, name: true },
      });
      if (raced) return NextResponse.json({ category: raced });
      throw error;
    }
  });
}

const BodySchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Give the category a name.")
    .max(60, "Keep it under 60 characters."),
});
