import { createHash } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError, handle } from "@/lib/api";
import { requireTenantApi } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { toKobo } from "@/lib/money";
import { requirePermission } from "@/lib/permissions";
import {
  MAX_IMAGE_BYTES,
  MAX_PDF_BYTES,
  MAX_THUMB_BYTES,
  getReceiptRow,
  listReceipts,
  sniffFileType,
  resolveSupplierName,
} from "@/lib/receipts";
import { nextSupplierReceiptNumber } from "@/lib/sequence";
import { deleteObject, putObject } from "@/lib/storage";

/** Big files and many shops take longer than an ordinary request (seconds). */
export const maxDuration = 60;

/**
 * Supplier receipts — the filing cabinet.
 *
 * Every delivery, from a company van or a Mile 12 stall, comes with a piece of
 * paper, and that paper is what settles the argument three months later about
 * what was delivered and what was paid. This is where it gets photographed and
 * filed so it can be found again by supplier name or by ID.
 *
 * WHO CAN DO WHAT
 * ---------------
 * `purchases.view` to look. Filing, editing and removing need their own grant,
 * `receipts.manage`, which by default only main admins and managers hold: a
 * storekeeper can receive goods but cannot file or delete the vendor's paper.
 * A cashier cannot see what the shop pays for stock at all.
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || null);

const FieldsSchema = z.object({
  supplierName: z.string().trim().min(1, "Type who the receipt is from.").max(120, "Keep the name under 120 characters."),
  receiptNo: optionalText(80),
  receiptDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date.")
    .optional(),
  amount: optionalText(40),
  note: optionalText(1000),
  purchaseId: optionalText(60),
  originalBytes: z.coerce.number().int().min(0).max(100_000_000).optional(),
});

function formText(form: FormData, key: string): string | undefined {
  const value = form.get(key);
  return typeof value === "string" ? value : undefined;
}

/** "2026-11" from a date — receipts are foldered by month so no folder grows forever. */
function monthFolder(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}/${m}`;
}

export async function GET(request: Request) {
  return handle(async () => {
    const session = await requireTenantApi();
    requirePermission(session.user, PERMISSIONS.PURCHASES_VIEW);

    const url = new URL(request.url);
    const fromParam = url.searchParams.get("from");
    const toParam = url.searchParams.get("to");
    const from = fromParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam) ? new Date(fromParam) : null;
    // `to` is inclusive for the person typing it, so the query runs to the
    // start of the following day.
    const to =
      toParam && /^\d{4}-\d{2}-\d{2}$/.test(toParam)
        ? new Date(new Date(toParam).getTime() + 24 * 60 * 60 * 1000)
        : null;

    const result = await listReceipts({
      organizationId: session.org.id,
      q: url.searchParams.get("q"),
      supplierId: url.searchParams.get("supplierId"),
      supplier: url.searchParams.get("supplier"),
      from,
      to,
      cursor: url.searchParams.get("cursor"),
    });

    return NextResponse.json(result);
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const session = await requireTenantApi();
    requirePermission(session.user, PERMISSIONS.RECEIPTS_MANAGE);

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new AppError("Expected a file upload.", { status: 400 });
    }

    const input = FieldsSchema.parse({
      supplierName: formText(form, "supplierName") ?? "",
      receiptNo: formText(form, "receiptNo"),
      receiptDate: formText(form, "receiptDate") || undefined,
      amount: formText(form, "amount"),
      note: formText(form, "note"),
      purchaseId: formText(form, "purchaseId"),
      originalBytes: formText(form, "originalBytes") || undefined,
    });

    // ── The file ─────────────────────────────────────────────────────────────
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw new AppError("Attach a photo or PDF of the receipt.", {
        fields: { file: "No file attached" },
      });
    }
    // Checked before the bytes are read into memory.
    if (file.size > MAX_PDF_BYTES) {
      throw new AppError("That file is too large. The limit is 5 MB.", {
        status: 413,
        fields: { file: "Too large" },
      });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = sniffFileType(bytes);
    if (!type) {
      throw new AppError("Only photos (JPG, PNG, WebP) and PDF files can be filed.", {
        status: 415,
        fields: { file: "Unsupported file type" },
      });
    }
    if (type.kind === "image" && bytes.length > MAX_IMAGE_BYTES) {
      throw new AppError("That photo is too large. Try taking it again.", {
        status: 413,
        fields: { file: "Too large" },
      });
    }

    // The thumbnail is a convenience. A bad one is dropped, never fatal.
    let thumbBytes: Uint8Array | null = null;
    const thumb = form.get("thumb");
    if (thumb instanceof File && thumb.size > 0 && thumb.size <= MAX_THUMB_BYTES) {
      const candidate = new Uint8Array(await thumb.arrayBuffer());
      if (sniffFileType(candidate)?.kind === "image") thumbBytes = candidate;
    }
    const thumbType = thumbBytes ? sniffFileType(thumbBytes) : null;

    // ── What it belongs to ───────────────────────────────────────────────────
    let supplier = await resolveSupplierName(session.org.id, input.supplierName);

    let purchaseId: string | null = null;
    if (input.purchaseId) {
      const purchase = await prisma.purchase.findFirst({
        where: { id: input.purchaseId, organizationId: session.org.id },
        select: { id: true, supplierId: true, supplier: { select: { name: true } } },
      });
      if (!purchase) {
        throw new AppError("That purchase no longer exists.", { status: 404 });
      }
      // Paper that backs up a delivery belongs to that delivery's supplier.
      if (supplier.supplierId && supplier.supplierId !== purchase.supplierId) {
        throw new AppError("That purchase is from a different supplier.", {
          fields: { supplierName: "Doesn't match the purchase" },
        });
      }
      supplier = { supplierId: purchase.supplierId, supplierName: supplier.supplierId ? supplier.supplierName : purchase.supplier.name };
      purchaseId = purchase.id;
    }

    let amountKobo: number | null = null;
    if (input.amount) {
      amountKobo = toKobo(input.amount);
      if (amountKobo <= 0 || amountKobo > 2_000_000_000) {
        throw new AppError("Enter the amount on the receipt.", {
          fields: { amount: "Not a valid amount" },
        });
      }
    }

    const now = new Date();
    const requested = input.receiptDate ? new Date(input.receiptDate) : now;
    // Backdating is normal (filing last week's paper); a future date is a typo.
    const receiptDate = requested.getTime() > now.getTime() ? now : requested;

    // ── Same photo twice? ────────────────────────────────────────────────────
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const duplicate = await prisma.supplierReceipt.findFirst({
      where: { organizationId: session.org.id, sha256 },
      select: { reference: true },
    });
    if (duplicate) {
      throw new AppError(`This exact file is already filed as ${duplicate.reference}.`, {
        status: 409,
        fields: { file: `Already filed as ${duplicate.reference}` },
      });
    }

    // ── Store the bytes, then the row ────────────────────────────────────────
    // Content-addressed: the name is the hash, so a file can never be silently
    // overwritten by a different one and can be cached by the browser forever.
    const base = `${session.org.id}/receipts/${monthFolder(receiptDate)}/${sha256.slice(0, 40)}`;
    const fileKey = `${base}.${type.ext}`;
    const thumbKey = thumbBytes && thumbType ? `${base}.thumb.${thumbType.ext}` : null;

    await putObject(fileKey, bytes);
    if (thumbKey && thumbBytes) await putObject(thumbKey, thumbBytes);

    let createdId: string;
    try {
      createdId = await prisma.$transaction(async (tx) => {
        const reference = await nextSupplierReceiptNumber(tx, session.org.id);
        const created = await tx.supplierReceipt.create({
          data: {
            organizationId: session.org.id,
            supplierId: supplier.supplierId,
            supplierName: supplier.supplierName,
            reference,
            receiptNo: input.receiptNo,
            receiptDate,
            amountKobo,
            note: input.note,
            purchaseId,
            fileKey,
            fileMime: type.mime,
            fileBytes: bytes.length,
            originalBytes: Math.max(input.originalBytes ?? 0, bytes.length),
            thumbKey,
            sha256,
            uploadedById: session.user.id,
            uploadedByName: session.user.name,
          },
          select: { id: true, reference: true },
        });
        await tx.auditLog.create({
          data: {
            organizationId: session.org.id,
            userId: session.user.id,
            userName: session.user.name,
            action: "SUPPLIER_RECEIPT_FILED",
            entity: "SupplierReceipt",
            entityId: created.id,
            summary: `Filed receipt ${created.reference} from ${supplier.supplierName}.`,
          },
        });
        return created.id;
      });
    } catch (error) {
      // The row didn't land, so the files are orphans. Remove them — unless the
      // failure is a second tab winning the same upload, whose row now owns them.
      const raced = await prisma.supplierReceipt
        .findFirst({ where: { organizationId: session.org.id, sha256 }, select: { id: true } })
        .catch(() => null);
      if (!raced) {
        await deleteObject(fileKey).catch(() => {});
        if (thumbKey) await deleteObject(thumbKey).catch(() => {});
      }
      throw error;
    }

    const receipt = await getReceiptRow(session.org.id, createdId);
    return NextResponse.json({ ok: true, receipt }, { status: 201 });
  });
}
