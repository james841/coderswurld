import { NextResponse } from "next/server";

import { AppError, handle } from "@/lib/api";
import { requireTenantApi } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/permissions";
import { pinnedBranch } from "@/lib/branchScope";
import { applyMovement, refreshProductExpiry } from "@/lib/stock";

/**
 * POST /api/stock/batches/:id/write-off: take what is left of one batch out
 * of stock as expired. Writes an EXPIRED movement to the ledger, so the stock
 * count, the history and the batch all agree afterwards.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = await requireTenantApi();
    requirePermission(session.user, PERMISSIONS.STOCK_ADJUST);
    const { id } = await params;
    const orgId = session.org.id;

    const batch = await prisma.stockBatch.findFirst({
      where: {
        id,
        organizationId: orgId,
        writtenOffAt: null,
        ...(pinnedBranch(session) ? { branchId: pinnedBranch(session)!.id } : {}),
        ...(session.user.department ? { product: { department: session.user.department } } : {}),
      },
      select: {
        id: true,
        productId: true,
        branchId: true,
        quantityLeft: true,
        batchNo: true,
        unitCostKobo: true,
        product: { select: { name: true } },
      },
    });
    if (!batch) throw new AppError("That batch was not found or was already removed.", { status: 404 });

    const removed = await prisma.$transaction(async (tx) => {
      const level = await tx.stockLevel.findUnique({
        where: { productId_branchId: { productId: batch.productId, branchId: batch.branchId } },
        select: { quantity: true },
      });
      // Never take out more than the shop's count says it holds.
      const qty = Math.min(batch.quantityLeft, Math.max(0, level?.quantity ?? 0));
      if (qty > 0) {
        await applyMovement(tx, {
          organizationId: orgId,
          branchId: batch.branchId,
          productId: batch.productId,
          quantity: -qty,
          type: "EXPIRED",
          unitCostKobo: batch.unitCostKobo,
          referenceType: "MANUAL",
          referenceId: batch.id,
          reason: `Expired batch${batch.batchNo ? ` ${batch.batchNo}` : ""} removed`,
          userId: session.user.id,
          fromBatchId: batch.id,
        });
      }
      await tx.stockBatch.update({
        where: { id: batch.id },
        data: { quantityLeft: 0, writtenOffAt: new Date() },
      });
      await refreshProductExpiry(tx, orgId, batch.productId);
      return qty;
    });

    return NextResponse.json({ ok: true, removed, product: batch.product.name });
  });
}
