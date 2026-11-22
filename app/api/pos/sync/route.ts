import { NextResponse } from "next/server";

import { AppError, handle } from "@/lib/api";
import { prisma } from "@/lib/db";
import { requireTenantApi } from "@/lib/auth";
import { requirePermission } from "@/lib/permissions";
import { PERMISSIONS } from "@/lib/constants";
import type { CatalogProduct, CatalogStock, SyncResponse } from "@/lib/pos";

/**
 * GET /api/pos/sync — the only endpoint the till talks to for its catalog.
 *
 * WHY THIS EXISTS INSTEAD OF /api/products
 * ----------------------------------------
 * The back-office product list is human-speed paging: a round trip per search
 * is fine. A till is not. A cashier types a name and the match must already be
 * on screen — there is no network in that moment. So the till holds the entire
 * catalog in IndexedDB and this endpoint answers one cheap question: "what has
 * changed since the version I hold?" First call downloads everything once;
 * every call after that returns only the handful of rows that moved, which is
 * usually none. That is what makes product load feel instant and keeps a shop
 * on a metered connection from re-downloading its catalogue all day.
 *
 * TWO CURSORS, DELIBERATELY
 * -------------------------
 * Products are versioned (`Organization.catalogVersion`) and move only on a
 * catalog edit. Stock moves on every sale. Tracking them together would make
 * every sale look like a catalog change and trigger a full product resync; so
 * products ride `version > since` and stock rides `updatedAt > stockSince`,
 * and a steady-state poll with no edits and no sales returns two empty arrays.
 */
export async function GET(request: Request) {
  return handle(async () => {
    const session = await requireTenantApi();
    requirePermission(session.user, PERMISSIONS.POS_SELL);

    if (!session.branch) {
      throw new AppError(
        "This till isn't attached to a shop branch, so it has no stock to sell.",
        { status: 400 },
      );
    }
    const branchId = session.branch.id;
    const orgId = session.org.id;

    const url = new URL(request.url);
    const since = toInt(url.searchParams.get("since"), 0);
    const stockSinceRaw = url.searchParams.get("stockSince");
    const stockSince = parseDate(stockSinceRaw);
    const deviceId = (url.searchParams.get("device") ?? "").trim() || null;
    const pending = toInt(url.searchParams.get("pending"), 0);
    const label = (url.searchParams.get("label") ?? "").trim() || null;
    const platform = (url.searchParams.get("platform") ?? "").trim() || null;

    // Large catalogues come in pages, so no single reply is big (Vercel refuses
    // replies over 4.5 MB, and a phone on a weak network would time out). The
    // till keeps asking with `after` until `more` is false. Pages run in id
    // order; `since` stays the same for the whole run.
    const after = (url.searchParams.get("after") ?? "").trim() || null;
    const stockAfter = (url.searchParams.get("stockAfter") ?? "").trim() || null;
    const limit = Math.min(Math.max(toInt(url.searchParams.get("limit"), PAGE), 100), PAGE);
    // Once one half is finished, the till says so and only the other half pages on.
    const skipProducts = url.searchParams.get("productsDone") === "1";
    const skipStock = url.searchParams.get("stockDone") === "1";

    // Read the version BEFORE the rows. Any edit that lands after this read
    // gets a higher version, so the till fetches it next time: a product may
    // be fetched twice, but never skipped.
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: orgId },
      select: { catalogVersion: true },
    });

    // A fresh till (since 0) or one somehow ahead of us (a restored backup, a
    // reset counter) gets the whole active catalogue. A full download skips
    // deactivated products — there is nothing on a blank till to remove.
    const full = since <= 0 || since > org.catalogVersion;

    const rows = skipProducts ? [] : await prisma.product.findMany({
      where: {
        ...(full ? { organizationId: orgId, isActive: true } : { organizationId: orgId, version: { gt: since } }),
        ...(after ? { id: { gt: after } } : {}),
      },
      select: {
        id: true,
        name: true,
        sku: true,
        barcode: true,
        unit: true,
        categoryId: true,
        category: { select: { name: true } },
        sellingPriceKobo: true,
        wholesalePriceKobo: true,
        wholesaleMinQty: true,
        imageThumb: true,
        trackExpiry: true,
        expiryDate: true,
        isActive: true,
        version: true,
        department: true,
      },
      orderBy: { id: "asc" },
      take: limit + 1,
    });
    const moreProducts = rows.length > limit;
    const products = moreProducts ? rows.slice(0, limit) : rows;

    const upserts: CatalogProduct[] = products.map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      barcode: p.barcode,
      unit: p.unit,
      categoryId: p.categoryId,
      categoryName: p.category?.name ?? null,
      sellingPriceKobo: p.sellingPriceKobo,
      wholesalePriceKobo: p.wholesalePriceKobo,
      wholesaleMinQty: p.wholesaleMinQty,
      imageThumb: p.imageThumb,
      trackExpiry: p.trackExpiry,
      expiryDate: p.expiryDate ? p.expiryDate.toISOString() : null,
      isActive: p.isActive,
      version: p.version,
      // Every product is sent, whatever department the cashier is in, and the
      // till shows only theirs. That way moving a cashier to the other
      // department works the moment they reload, with no stale catalogue.
      // The sale route is what actually refuses the wrong department.
      department: p.department,
    }));

    // Stock is the volatile half, paged on its own cursor. On a first sync,
    // or alongside a full catalog download, the whole branch snapshot comes
    // down so the till starts from truth; after that, only levels touched
    // since the client's last sync.
    const stockFull = full || !stockSince;
    const levelRows = skipStock ? [] : await prisma.stockLevel.findMany({
      where: {
        organizationId: orgId,
        branchId,
        ...(stockFull ? {} : { updatedAt: { gt: stockSince } }),
        ...(stockAfter ? { productId: { gt: stockAfter } } : {}),
      },
      select: { productId: true, quantity: true },
      orderBy: { productId: "asc" },
      take: STOCK_PAGE + 1,
    });
    const moreStock = levelRows.length > STOCK_PAGE;
    const levels = moreStock ? levelRows.slice(0, STOCK_PAGE) : levelRows;
    const stock: CatalogStock[] = levels.map((l) => ({ p: l.productId, q: l.quantity }));

    // On the first page, say how much is coming, so the till can show progress.
    const total =
      !after && !stockAfter && moreProducts
        ? await prisma.product.count({
            where: full ? { organizationId: orgId, isActive: true } : { organizationId: orgId, version: { gt: since } },
          })
        : null;

    // Record the device's heartbeat. Best-effort: a dashboard that can't show
    // "last seen 2 min ago" is a cosmetic loss, and must never fail a sync the
    // cashier is waiting on.
    if (deviceId) {
      try {
        const now = new Date();
        await prisma.device.upsert({
          where: { organizationId_deviceId: { organizationId: orgId, deviceId } },
          create: {
            organizationId: orgId,
            branchId,
            deviceId,
            label,
            platform,
            catalogVersionSeen: org.catalogVersion,
            pendingCount: pending,
            lastSeenAt: now,
            lastSyncAt: now,
          },
          update: {
            branchId,
            ...(label ? { label } : {}),
            ...(platform ? { platform } : {}),
            catalogVersionSeen: org.catalogVersion,
            pendingCount: pending,
            lastSeenAt: now,
            lastSyncAt: now,
          },
        });
      } catch (error) {
        console.error("[pos/sync] device heartbeat failed:", error);
      }
    }

    const response: SyncResponse = {
      catalogVersion: org.catalogVersion,
      full,
      upserts,
      stock,
      stockFull,
      serverTime: new Date().toISOString(),
      more: moreProducts || moreStock,
      nextAfter: moreProducts ? products[products.length - 1].id : null,
      nextStockAfter: moreStock ? levels[levels.length - 1].productId : null,
      productsDone: !moreProducts,
      stockDone: !moreStock,
      total,
    };
    return NextResponse.json(response);
  });
}

/** Products per reply: about 1 MB of JSON. */
const PAGE = 2500;
/** Stock rows are tiny (id and number), so more fit in a reply. */
const STOCK_PAGE = 20000;

function toInt(raw: string | null, fallback: number): number {
  if (raw === null || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

/** A query-string ISO timestamp, or null for anything unparseable. */
function parseDate(raw: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}
