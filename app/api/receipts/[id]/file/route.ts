import { NextResponse } from "next/server";

import { AppError, handle } from "@/lib/api";
import { requireTenantApi } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/permissions";
import { sniffFileType } from "@/lib/receipts";
import { getObject } from "@/lib/storage";

/**
 * Serves a filed receipt — the photo, its thumbnail (`?thumb=1`), or a download
 * (`?download=1`).
 *
 * This route is the only door to the storage folder. It checks the session, the
 * permission and — through `organizationId` in the lookup — that the receipt
 * belongs to the caller's business. Guessing another shop's receipt id gets a
 * 404, the same answer as an id that never existed.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = await requireTenantApi();
    requirePermission(session.user, PERMISSIONS.PURCHASES_VIEW);
    const { id } = await params;

    const url = new URL(request.url);
    const wantThumb = url.searchParams.get("thumb") === "1";
    const download = url.searchParams.get("download") === "1";

    const receipt = await prisma.supplierReceipt.findFirst({
      where: { id, organizationId: session.org.id },
      select: { reference: true, fileKey: true, fileMime: true, thumbKey: true },
    });
    if (!receipt) throw new AppError("That receipt no longer exists.", { status: 404 });

    const key = wantThumb ? receipt.thumbKey : receipt.fileKey;
    const bytes = key ? await getObject(key) : null;
    if (!bytes) throw new AppError("The file for this receipt is missing.", { status: 404 });

    const mime = wantThumb ? (sniffFileType(bytes)?.mime ?? "image/webp") : receipt.fileMime;
    const ext = key!.slice(key!.lastIndexOf(".") + 1);

    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Content-Length": String(bytes.length),
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${receipt.reference}.${ext}"`,
        // The file behind an id never changes (it is named by its own hash), so
        // the browser may keep it for good — but only this user's browser, never
        // a shared cache in between.
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
