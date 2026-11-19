import { NextResponse } from "next/server";

import { z } from "zod";

import { AppError, handle, readJson } from "@/lib/api";
import { prisma } from "@/lib/db";
import { requireTenantApi } from "@/lib/auth";
import { requirePermission } from "@/lib/permissions";
import { PERMISSIONS } from "@/lib/constants";
import { cancelPurchase, correctPurchase } from "@/lib/purchaseEdit";

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

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/purchases/[id] — correct a mistake, or cancel the whole purchase.
// Admins and managers (purchases.manage). A reason is always required: it is
// what the next person reads in the purchase's history.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_KOBO = 2_000_000_000;
const emptyToNull = (v: unknown) => (v === "" || v === null || v === undefined ? null : v);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

const Reason = z.string().trim().min(3, "Say what was wrong, in a few words.").max(300);

const CorrectSchema = z.object({
  action: z.literal("correct"),
  reason: Reason,
  supplierId: z.string().min(1, "Choose who you bought from."),
  invoiceNo: optionalText(60),
  purchaseDate: z.coerce.date(),
  transportKobo: z.number().int().min(0).max(MAX_KOBO),
  otherCostKobo: z.number().int().min(0).max(MAX_KOBO),
  note: optionalText(2000),
  lines: z
    .array(
      z.object({
        id: z.string().nullish(),
        productId: z.string().min(1),
        quantity: z.number().positive("Quantity must be more than zero.").max(1_000_000, "That quantity looks wrong."),
        unitCostKobo: z.number().int().min(0, "Cost can't be negative.").max(MAX_KOBO),
        batchNo: optionalText(60),
        expiryDate: z.preprocess(emptyToNull, z.coerce.date().nullable()),
      }),
    )
    .min(1, "Keep at least one item. To remove the whole purchase, cancel it instead."),
});

const CancelSchema = z.object({ action: z.literal("cancel"), reason: Reason });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = await requireTenantApi();
    requirePermission(session.user, PERMISSIONS.PURCHASES_MANAGE);
    const { id } = await params;
    const body = await readJson(request);
    const parsed = z.discriminatedUnion("action", [CorrectSchema, CancelSchema]).safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new AppError(issue?.message ?? "Check the details.", {
        status: 422,
        fields: issue?.path?.length ? { [String(issue.path[0])]: issue.message } : undefined,
      });
    }
    const actor = { organizationId: session.org.id, userId: session.user.id, userName: session.user.name };
    const input = parsed.data;

    const result = await prisma.$transaction(
      (tx) =>
        input.action === "cancel"
          ? cancelPurchase(tx, actor, id, input.reason)
          : correctPurchase(tx, actor, id, {
              reason: input.reason,
              supplierId: input.supplierId,
              invoiceNo: input.invoiceNo,
              purchaseDate: input.purchaseDate,
              transportKobo: input.transportKobo,
              otherCostKobo: input.otherCostKobo,
              note: input.note,
              lines: input.lines.map((l) => ({
                id: l.id ?? null,
                productId: l.productId,
                quantity: l.quantity,
                unitCostKobo: l.unitCostKobo,
                batchNo: l.batchNo,
                expiryDate: l.expiryDate,
              })),
            }),
      { timeout: 20_000 },
    );

    await prisma.auditLog
      .create({
        data: {
          organizationId: session.org.id,
          userId: session.user.id,
          userName: session.user.name,
          action: input.action === "cancel" ? "PURCHASE_CANCELLED" : "PURCHASE_CORRECTED",
          entity: "Purchase",
          entityId: id,
          summary: `${input.action === "cancel" ? "Cancelled" : "Corrected"} a purchase: ${input.reason}`,
        },
      })
      .catch((error) => console.error("[purchases/[id]] audit write failed:", error));

    return NextResponse.json({ ok: true, changes: result.changes });
  });
}
