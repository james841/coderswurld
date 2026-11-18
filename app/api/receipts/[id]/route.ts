import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError, handle, readJson } from "@/lib/api";
import { requireTenantApi } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { toKobo } from "@/lib/money";
import { requirePermission } from "@/lib/permissions";
import { getReceiptRow, resolveSupplierName } from "@/lib/receipts";
import { deleteObject } from "@/lib/storage";

/**
 * One filed receipt: correct its details, or remove it.
 *
 * The file itself is never replaced through here. A receipt is evidence; if the
 * photo is wrong, the honest record is "this one was removed and a new one
 * filed", and the audit log shows both.
 */

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v || null));

const PatchSchema = z.object({
  supplierName: z.string().trim().min(1, "Type who the receipt is from.").max(120).optional(),
  receiptNo: nullableText(80),
  receiptDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date.")
    .optional(),
  amount: nullableText(40),
  note: nullableText(1000),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = await requireTenantApi();
    requirePermission(session.user, PERMISSIONS.RECEIPTS_MANAGE);
    const { id } = await params;

    const input = PatchSchema.parse(await readJson(request));

    const existing = await prisma.supplierReceipt.findFirst({
      where: { id, organizationId: session.org.id },
      select: { id: true, reference: true, supplierId: true, purchaseId: true },
    });
    if (!existing) throw new AppError("That receipt no longer exists.", { status: 404 });

    const data: {
      supplierId?: string | null;
      supplierName?: string;
      purchaseId?: null;
      receiptNo?: string | null;
      receiptDate?: Date;
      amountKobo?: number | null;
      note?: string | null;
    } = {};

    if (input.supplierName) {
      const next = await resolveSupplierName(session.org.id, input.supplierName);
      data.supplierId = next.supplierId;
      data.supplierName = next.supplierName;
      // A linked purchase belongs to one supplier; moving the paper to another
      // supplier would attach it to someone else's delivery, so unlink it.
      if (existing.purchaseId && next.supplierId !== existing.supplierId) data.purchaseId = null;
    }

    if (input.receiptNo !== undefined) data.receiptNo = input.receiptNo;
    if (input.note !== undefined) data.note = input.note;

    if (input.receiptDate) {
      const now = new Date();
      const requested = new Date(input.receiptDate);
      data.receiptDate = requested.getTime() > now.getTime() ? now : requested;
    }

    if (input.amount !== undefined) {
      if (input.amount === null) {
        data.amountKobo = null;
      } else {
        const kobo = toKobo(input.amount);
        if (kobo <= 0 || kobo > 2_000_000_000) {
          throw new AppError("Enter the amount on the receipt.", {
            fields: { amount: "Not a valid amount" },
          });
        }
        data.amountKobo = kobo;
      }
    }

    await prisma.$transaction([
      prisma.supplierReceipt.updateMany({
        where: { id, organizationId: session.org.id },
        data,
      }),
      prisma.auditLog.create({
        data: {
          organizationId: session.org.id,
          userId: session.user.id,
          userName: session.user.name,
          action: "SUPPLIER_RECEIPT_EDITED",
          entity: "SupplierReceipt",
          entityId: id,
          summary: `Edited the details of receipt ${existing.reference}.`,
        },
      }),
    ]);

    const receipt = await getReceiptRow(session.org.id, id);
    return NextResponse.json({ ok: true, receipt });
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = await requireTenantApi();
    requirePermission(session.user, PERMISSIONS.RECEIPTS_MANAGE);
    const { id } = await params;

    const existing = await prisma.supplierReceipt.findFirst({
      where: { id, organizationId: session.org.id },
      select: { id: true, reference: true, supplierName: true, fileKey: true, thumbKey: true },
    });
    if (!existing) throw new AppError("That receipt no longer exists.", { status: 404 });

    // Row first, files second. If the file delete fails we are left with an
    // orphan file nobody can reach — harmless. The other order could leave a
    // row pointing at nothing, which is a broken page for the user.
    await prisma.$transaction([
      prisma.supplierReceipt.deleteMany({ where: { id, organizationId: session.org.id } }),
      prisma.auditLog.create({
        data: {
          organizationId: session.org.id,
          userId: session.user.id,
          userName: session.user.name,
          action: "SUPPLIER_RECEIPT_DELETED",
          entity: "SupplierReceipt",
          entityId: id,
          summary: `Deleted receipt ${existing.reference} from ${existing.supplierName}.`,
        },
      }),
    ]);

    await deleteObject(existing.fileKey).catch((error) =>
      console.error("[receipts] could not remove file", existing.fileKey, error),
    );
    if (existing.thumbKey) await deleteObject(existing.thumbKey).catch(() => {});

    return NextResponse.json({ ok: true });
  });
}
