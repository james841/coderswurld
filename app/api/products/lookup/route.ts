import { NextResponse } from "next/server";

import { handle, AppError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { requireTenantApi } from "@/lib/auth";
import { requirePermission } from "@/lib/permissions";
import { PERMISSIONS } from "@/lib/constants";

import { canSeeCost } from "../route";

/**
 * GET /api/products/lookup?barcode=... | ?sku=...
 *
 * A single, exact lookup for the back office — "I just scanned this, what is it?"
 * and "is this barcode already taken before I assign it?". It is deliberately not
 * the POS path: the till resolves scans against its own IndexedDB catalog with no
 * network at all. This exists for the product screens, where a round trip per
 * scan is fine and the authoritative answer is the one that matters.
 *
 * Returns `{ product: null }` with a 200, not a 404, for "nothing matches". A
 * miss is the normal, expected answer when you scan a brand-new item to add it —
 * making the caller catch an error for the happy path is backwards.
 */
export async function GET(request: Request) {
  return handle(async () => {
    const session = await requireTenantApi();
    requirePermission(session.user, PERMISSIONS.PRODUCTS_VIEW);

    const url = new URL(request.url);
    const barcode = url.searchParams.get("barcode")?.trim();
    const sku = url.searchParams.get("sku")?.trim();

    if (!barcode && !sku) {
      throw new AppError("Pass a barcode or sku to look up.", { status: 400 });
    }

    const product = await prisma.product.findFirst({
      where: {
        organizationId: session.org.id,
        ...(barcode ? { barcode } : { sku: sku!.toUpperCase() }),
      },
      select: {
        id: true,
        name: true,
        sku: true,
        barcode: true,
        unit: true,
        sellingPriceKobo: true,
        costPriceKobo: true,
        wholesalePriceKobo: true,
        isActive: true,
        category: { select: { id: true, name: true } },
        stockLevels: {
          where: { branchId: session.branch?.id ?? undefined },
          select: { quantity: true },
        },
      },
    });

    if (!product) {
      return NextResponse.json({ product: null });
    }

    const quantity = product.stockLevels.reduce((sum, l) => sum + l.quantity, 0);
    const { costPriceKobo, stockLevels: _levels, ...rest } = product;

    return NextResponse.json({
      product: {
        ...rest,
        quantity,
        ...(canSeeCost(session.user) ? { costPriceKobo } : {}),
      },
    });
  });
}
