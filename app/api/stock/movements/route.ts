import { NextResponse } from "next/server";

import { AppError, handle } from "@/lib/api";
import { prisma } from "@/lib/db";
import { requireTenantApi } from "@/lib/auth";
import { requirePermission } from "@/lib/permissions";
import { PERMISSIONS } from "@/lib/constants";

/**
 * GET /api/stock/movements?productId=&branchId= — the recent history of one
 * product at one branch, newest first.
 *
 * This is the "why is it 136?" view. The stock figure on the list is a cache; the
 * truth is this ledger. The adjust sheet fetches it when it opens so a manager can
 * see what moved before they change anything — a short tail, not the whole life of
 * the product, because the question is almost always "what happened lately?".
 */

const TAKE = 15;

export async function GET(request: Request) {
  return handle(async () => {
    const session = await requireTenantApi();
    requirePermission(session.user, PERMISSIONS.STOCK_VIEW);
    const orgId = session.org.id;

    const url = new URL(request.url);
    const productId = url.searchParams.get("productId")?.trim();
    const branchId = url.searchParams.get("branchId")?.trim() || session.branch?.id || null;

    if (!productId) {
      throw new AppError("Which product?", { status: 400 });
    }
    if (!branchId) {
      throw new AppError("Which branch?", { status: 400 });
    }

    // Confirm the product is this org's before reading its ledger.
    const product = await prisma.product.findFirst({
      where: { id: productId, organizationId: orgId },
      select: { id: true },
    });
    if (!product) throw new AppError("That product no longer exists.", { status: 404 });

    const movements = await prisma.stockMovement.findMany({
      where: { organizationId: orgId, productId, branchId },
      orderBy: { createdAt: "desc" },
      take: TAKE,
      select: {
        id: true,
        type: true,
        quantity: true,
        balanceAfter: true,
        reason: true,
        referenceType: true,
        referenceId: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      movements: movements.map((m) => ({
        id: m.id,
        type: m.type,
        quantity: m.quantity,
        balanceAfter: m.balanceAfter,
        reason: m.reason,
        referenceType: m.referenceType,
        referenceId: m.referenceId,
        createdAt: m.createdAt.toISOString(),
      })),
    });
  });
}
