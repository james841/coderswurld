import { NextResponse } from "next/server";

import { handle } from "@/lib/api";
import { prisma } from "@/lib/db";
import { requireTenantApi } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { AppError } from "@/lib/api";
import { PERMISSIONS } from "@/lib/constants";

/**
 * GET /api/products/pick?q=…   or   ?barcode=…
 *
 * A small, fast product lookup for pickers (recording or correcting a
 * purchase). It returns a dozen matches instead of the whole catalogue, so
 * the page stays light with 200,000 products. A barcode is matched exactly
 * (a scan); text matches the name, SKU or barcode.
 */
export async function GET(request: Request) {
  return handle(async () => {
    const session = await requireTenantApi();
    if (
      !hasPermission(session.user, PERMISSIONS.PURCHASES_MANAGE) &&
      !hasPermission(session.user, PERMISSIONS.PRODUCTS_VIEW)
    ) {
      throw new AppError("You don't have access to products.", { status: 403 });
    }
    const url = new URL(request.url);
    const barcode = (url.searchParams.get("barcode") ?? "").trim();
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
    const select = { id: true, name: true, sku: true, barcode: true, unit: true, costPriceKobo: true } as const;

    if (barcode) {
      const hit = await prisma.product.findFirst({
        where: { organizationId: session.org.id, isActive: true, barcode },
        select,
      });
      return NextResponse.json({ items: hit ? [hit] : [] });
    }
    if (q.length < 2) return NextResponse.json({ items: [] });

    const items = await prisma.product.findMany({
      where: {
        organizationId: session.org.id,
        isActive: true,
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { sku: { startsWith: q, mode: "insensitive" } },
          { barcode: { startsWith: q } },
        ],
      },
      select,
      orderBy: { name: "asc" },
      take: 12,
    });
    return NextResponse.json({ items });
  });
}
