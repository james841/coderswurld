import { NextResponse } from "next/server";

import { AppError, handle } from "@/lib/api";
import { prisma } from "@/lib/db";
import { requireTenantApi } from "@/lib/auth";
import { requirePermission } from "@/lib/permissions";
import { PERMISSIONS } from "@/lib/constants";

/**
 * GET /api/purchases/[id] — one delivery in full: its lines, what each cost,
 * every payment made against it and what is still owed. The detail page reads
 * this; the list route stays lean and never joins items or payments.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = await requireTenantApi();
    requirePermission(session.user, PERMISSIONS.PURCHASES_VIEW);
    const orgId = session.org.id;

    const { id } = await params;

    const purchase = await prisma.purchase.findFirst({
      where: { id, organizationId: orgId },
      select: {
        id: true,
        reference: true,
        invoiceNo: true,
        purchaseDate: true,
        subtotalKobo: true,
        transportKobo: true,
        otherCostKobo: true,
        totalKobo: true,
        amountPaidKobo: true,
        balanceKobo: true,
        paymentStatus: true,
        status: true,
        note: true,
        supplier: { select: { id: true, name: true, phone: true, whatsapp: true } },
        branch: { select: { name: true, code: true } },
        items: {
          select: {
            id: true,
            quantity: true,
            unitCostKobo: true,
            lineTotalKobo: true,
            batchNo: true,
            expiryDate: true,
            product: { select: { id: true, name: true, sku: true, unit: true } },
          },
        },
        payments: {
          where: { direction: "OUT" },
          orderBy: { paidAt: "desc" },
          select: {
            id: true,
            amountKobo: true,
            method: true,
            reference: true,
            paidAt: true,
          },
        },
      },
    });

    if (!purchase) throw new AppError("That purchase no longer exists.", { status: 404 });

    return NextResponse.json({
      purchase: {
        id: purchase.id,
        reference: purchase.reference,
        invoiceNo: purchase.invoiceNo,
        purchaseDate: purchase.purchaseDate.toISOString(),
        subtotalKobo: purchase.subtotalKobo,
        transportKobo: purchase.transportKobo,
        otherCostKobo: purchase.otherCostKobo,
        totalKobo: purchase.totalKobo,
        amountPaidKobo: purchase.amountPaidKobo,
        balanceKobo: purchase.balanceKobo,
        paymentStatus: purchase.paymentStatus,
        status: purchase.status,
        note: purchase.note,
        supplier: purchase.supplier,
        branch: purchase.branch,
        items: purchase.items.map((it) => ({
          id: it.id,
          quantity: it.quantity,
          unitCostKobo: it.unitCostKobo,
          lineTotalKobo: it.lineTotalKobo,
          batchNo: it.batchNo,
          expiryDate: it.expiryDate ? it.expiryDate.toISOString() : null,
          productId: it.product?.id ?? null,
          productName: it.product?.name ?? "(removed product)",
          sku: it.product?.sku ?? null,
          unit: it.product?.unit ?? "pcs",
        })),
        payments: purchase.payments.map((pay) => ({
          id: pay.id,
          amountKobo: pay.amountKobo,
          method: pay.method,
          reference: pay.reference,
          paidAt: pay.paidAt.toISOString(),
        })),
      },
    });
  });
}
