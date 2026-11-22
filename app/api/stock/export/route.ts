import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError, handle } from "@/lib/api";
import { requireTenantApi } from "@/lib/auth";
import { PERMISSIONS, SEES_ALL_DEPARTMENTS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/permissions";
import { pinnedBranch } from "@/lib/branchScope";
import { buildStockExport, exportFileName, renderDocx, exportRowCount, renderPdf, renderXlsx } from "@/lib/stockExport";

/** Big files and many shops take longer than an ordinary request (seconds). */
export const maxDuration = 60;

/**
 * GET /api/stock/export?format=xlsx|pdf|docx&department=ALL|SUPERMARKET|PHARMACY&branch=<id|all>&category=<id|none|all>
 *
 * Admins and managers only: a stock record can show the whole business,
 * both counters and every branch, which a cashier must not be able to pull.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({
  format: z.enum(["xlsx", "pdf", "docx"]),
  department: z.enum(["ALL", "SUPERMARKET", "PHARMACY"]).default("ALL"),
  branch: z.string().max(40).optional(),
  /** A category id, "none" for uncategorised, or "all". */
  category: z.string().max(40).optional(),
});

const TYPES = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;

/** Most a PDF or Word export will hold. */
const PRINTABLE_ROWS = 20_000;

export async function GET(request: Request) {
  return handle(async () => {
    const session = await requireTenantApi();
    requirePermission(session.user, PERMISSIONS.STOCK_VIEW);
    if (!(SEES_ALL_DEPARTMENTS as readonly string[]).includes(session.user.role)) {
      throw new AppError("Only admins and managers can download stock records.", { status: 403 });
    }

    const url = new URL(request.url);
    const q = Query.parse(Object.fromEntries(url.searchParams));
    const orgId = session.org.id;

    const [settings, branches] = await Promise.all([
      prisma.orgSettings.findUnique({ where: { organizationId: orgId }, select: { departmentsEnabled: true, defaultLowStock: true } }),
      prisma.branch.findMany({ where: { organizationId: orgId, isActive: true }, select: { id: true, name: true } }),
    ]);

    // A manager pinned to one branch only ever gets that branch.
    let branch: { id: string; name: string } | null = null;
    const pinned = pinnedBranch(session);
    if (pinned) branch = { id: pinned.id, name: pinned.name };
    else if (q.branch && q.branch !== "all") {
      branch = branches.find((b) => b.id === q.branch) ?? null;
      if (!branch) throw new AppError("That branch was not found.", { status: 404 });
    }

    const data = await buildStockExport({
      organizationId: orgId,
      shopName: session.org.name,
      timezone: session.org.timezone,
      branch,
      department: settings?.departmentsEnabled ? q.department : "ALL",
      departmentsEnabled: Boolean(settings?.departmentsEnabled),
      categoryId: !q.category || q.category === "all" ? null : q.category,
      generatedBy: session.user.name,
      defaultLowStock: settings?.defaultLowStock ?? 5,
    });

    // A PDF or Word file of 200,000 products is thousands of pages that nobody
    // can print or open comfortably. Excel handles any size.
    const count = exportRowCount(data);
    if (q.format !== "xlsx" && count > PRINTABLE_ROWS) {
      throw new AppError(
        `That is ${count.toLocaleString("en-NG")} products, too many for a ${q.format === "pdf" ? "PDF" : "Word"} file. Download Excel instead, or choose one category.`,
        { status: 422 },
      );
    }

    const body = q.format === "xlsx" ? await renderXlsx(data) : q.format === "pdf" ? await renderPdf(data) : await renderDocx(data);

    // Sent as a stream: Vercel refuses ordinary replies over 4.5 MB, and a big
    // shop's Excel file is larger than that.
    const bytes = new Uint8Array(body);
    const CHUNK = 256 * 1024;
    let offset = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= bytes.length) {
          controller.close();
          return;
        }
        controller.enqueue(bytes.subarray(offset, offset + CHUNK));
        offset += CHUNK;
      },
    });

    return new NextResponse(stream, {
      headers: {
        "Content-Type": TYPES[q.format],
        "Content-Disposition": `attachment; filename="${exportFileName(data, q.format)}"`,
        "Cache-Control": "no-store",
      },
    });
  });
}
