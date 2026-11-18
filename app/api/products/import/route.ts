import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError, handle, readJson } from "@/lib/api";
import { prisma } from "@/lib/db";
import { requireTenantApi } from "@/lib/auth";
import { requirePermission } from "@/lib/permissions";
import { PERMISSIONS } from "@/lib/constants";
import { bumpCatalogVersion } from "@/lib/catalog";
import { applyMovement } from "@/lib/stock";
import { generateSku } from "@/lib/sequence";
import { ProductInputSchema } from "@/lib/productInput";

/** Big files and many shops take longer than an ordinary request (seconds). */
export const maxDuration = 60;

/**
 * POST /api/products/import — one chunk of a bulk Excel import.
 *
 * HOW THE WORK IS SPLIT
 * ---------------------
 * The spreadsheet is parsed and the columns are mapped *in the browser* with
 * SheetJS — a 4,000-row file never crosses the wire as a file. The client posts
 * already-normalised rows in chunks of a few hundred, and this route handles one
 * chunk per request. That keeps any single request small and lets the client
 * draw a progress bar that actually moves.
 *
 * WHY ROWS SUCCEED AND FAIL INDEPENDENTLY
 * ---------------------------------------
 * A shopkeeper importing their whole inventory does not want 1,900 good rows
 * rejected because row 1,901 has "N/A" where a price should be. Each row is
 * validated and written on its own; the ones that fail come back with their row
 * number and a plain-English reason, so the person can fix those few and
 * re-import just them. The catalog version is bumped once, at the end, for the
 * whole chunk.
 *
 * MATCHING, SO RE-IMPORTING ISN'T DOUBLING
 * ----------------------------------------
 * A row is matched to an existing product by barcode, then by SKU. A match
 * updates the product's details and prices but NOT its stock — re-running an
 * import must never silently double a shop's quantities. Opening stock is only
 * applied to genuinely new products.
 */

/** A chunk is capped so one request stays small and quick. The client paginates. */
const MAX_ROWS = 500;

const BodySchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(MAX_ROWS),
});

interface RowError {
  row: number;
  name: string | null;
  message: string;
}

export async function POST(request: Request) {
  return handle(async () => {
    const session = await requireTenantApi();
    requirePermission(session.user, PERMISSIONS.PRODUCTS_IMPORT);

    if (!session.branch) {
      throw new AppError(
        "Your account isn't attached to a shop branch, so imported stock has nowhere to go.",
        { status: 400 },
      );
    }
    const branchId = session.branch.id;
    const orgId = session.org.id;

    const { rows } = BodySchema.parse(await readJson(request));

    // Name→id caches, filled on demand. A 500-row sheet typically references a
    // dozen categories and a handful of markets; resolving each once keeps the
    // import from issuing the same lookup hundreds of times.
    const categoryCache = new Map<string, string>();
    const supplierCache = new Map<string, string>();

    const errors: RowError[] = [];
    const touchedIds: string[] = [];
    let created = 0;
    let updated = 0;

    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i];
      // Row number as the user sees it in Excel: 1-based, and +1 again for the
      // header row the client stripped. The client passes its own base offset for
      // multi-chunk files; default to this chunk's own numbering.
      const rowNumber = numberOr(raw.__row, i + 2);

      try {
        const categoryId = await resolveName(
          categoryCache,
          text(raw.category),
          (name) => findOrCreateCategory(orgId, name),
        );
        const supplierId = await resolveName(
          supplierCache,
          text(raw.supplier),
          (name) => findOrCreateSupplier(orgId, name),
        );

        // A row carrying an expiry date almost certainly wants tracking on — the
        // person typed a date for a reason. Only infer when they didn't say.
        const hasExpiry = text(raw.expiryDate) !== null;
        const trackExpiry =
          raw.trackExpiry !== undefined ? raw.trackExpiry : hasExpiry ? true : undefined;

        const parsed = ProductInputSchema.safeParse({
          name: raw.name,
          sku: raw.sku,
          barcode: raw.barcode,
          description: raw.description,
          unit: raw.unit,
          packSize: raw.packSize,
          costPrice: raw.costPrice,
          sellingPrice: raw.sellingPrice,
          wholesalePrice: raw.wholesalePrice,
          wholesaleMinQty: raw.wholesaleMinQty,
          minStock: raw.minStock,
          openingStock: raw.openingStock,
          trackExpiry,
          expiryDate: raw.expiryDate,
          categoryId,
          supplierId,
        });

        if (!parsed.success) {
          errors.push({
            row: rowNumber,
            name: text(raw.name),
            message: firstIssue(parsed.error),
          });
          continue;
        }
        const input = parsed.data;

        // Match by barcode, then SKU. Sequential processing means a duplicate
        // barcode later in the same chunk updates the row an earlier line created
        // rather than colliding on the unique index.
        const match = await prisma.product.findFirst({
          where: {
            organizationId: orgId,
            ...(input.barcode
              ? { barcode: input.barcode }
              : input.sku
                ? { sku: input.sku }
                : { id: "__never__" }),
          },
          select: { id: true },
        });

        if (match) {
          await prisma.product.update({
            where: { id: match.id },
            data: {
              name: input.name,
              barcode: input.barcode,
              description: input.description,
              unit: input.unit,
              packSize: input.packSize,
              costPriceKobo: input.costPrice,
              sellingPriceKobo: input.sellingPrice,
              wholesalePriceKobo: input.wholesalePrice,
              wholesaleMinQty: input.wholesaleMinQty,
              minStock: input.minStock,
              trackExpiry: input.trackExpiry,
              expiryDate: input.trackExpiry ? input.expiryDate : null,
              ...(categoryId ? { categoryId } : {}),
              ...(supplierId ? { supplierId } : {}),
            },
          });
          touchedIds.push(match.id);
          updated++;
        } else {
          const sku = input.sku ?? generateSku(input.name);
          const createdProduct = await prisma.$transaction(async (tx) => {
            const product = await tx.product.create({
              data: {
                organizationId: orgId,
                categoryId,
                supplierId,
                name: input.name,
                sku,
                barcode: input.barcode,
                description: input.description,
                unit: input.unit,
                packSize: input.packSize,
                costPriceKobo: input.costPrice,
                sellingPriceKobo: input.sellingPrice,
                wholesalePriceKobo: input.wholesalePrice,
                wholesaleMinQty: input.wholesaleMinQty,
                minStock: input.minStock,
                trackExpiry: input.trackExpiry,
                expiryDate: input.trackExpiry ? input.expiryDate : null,
                createdById: session.user.id,
              },
              select: { id: true },
            });

            if (input.openingStock && input.openingStock > 0) {
              await applyMovement(tx, {
                organizationId: orgId,
                branchId,
                productId: product.id,
                quantity: input.openingStock,
                type: "OPENING",
                unitCostKobo: input.costPrice,
                referenceType: "IMPORT",
                reason: "Opening stock from Excel import",
                userId: session.user.id,
                batch: input.trackExpiry && input.expiryDate ? { expiryDate: input.expiryDate, source: "OPENING" } : null,
              });
            }
            return product;
          });
          touchedIds.push(createdProduct.id);
          created++;
        }
      } catch (error) {
        // A barcode/SKU that collides with a row NOT in this chunk lands here as
        // a P2002. Report it against the row and keep going — a per-row failure
        // must not take the whole import down.
        errors.push({ row: rowNumber, name: text(raw.name), message: rowErrorMessage(error) });
      }
    }

    // One bump for the whole chunk, then stamp every product it touched with that
    // version. Done at the end on purpose: bumping up front and advancing the
    // number as the loop runs would let a till sync mid-import, record the new
    // high-water mark, and then never pull the rows written after it synced.
    let catalogVersion: number | null = null;
    if (touchedIds.length > 0) {
      catalogVersion = await prisma.$transaction(async (tx) => {
        const version = await bumpCatalogVersion(orgId, tx);
        await tx.product.updateMany({
          where: { id: { in: touchedIds }, organizationId: orgId },
          data: { version },
        });
        return version;
      });
    }

    if (created + updated > 0) {
      await prisma.auditLog
        .create({
          data: {
            organizationId: orgId,
            userId: session.user.id,
            userName: session.user.name,
            action: "PRODUCTS_IMPORTED",
            entity: "Product",
            summary: `Imported ${created} new, updated ${updated}${errors.length ? `, ${errors.length} skipped` : ""} from Excel.`,
          },
        })
        .catch((err) => console.error("[products/import] audit write failed:", err));
    }

    return NextResponse.json({
      received: rows.length,
      created,
      updated,
      failed: errors.length,
      errors,
      catalogVersion,
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Trimmed non-empty string, or null. Excel hands us numbers, nulls and spaces. */
function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

function numberOr(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function resolveName(
  cache: Map<string, string>,
  name: string | null,
  create: (name: string) => Promise<string>,
): Promise<string | null> {
  if (!name) return null;
  const key = name.toLowerCase();
  const cached = cache.get(key);
  if (cached) return cached;
  const id = await create(name);
  cache.set(key, id);
  return id;
}

/**
 * Import auto-creates the categories and markets a sheet references by name —
 * that is the point of a bulk import, and forcing the owner to pre-create forty
 * categories by hand first would defeat it. Case-insensitive match so "Drinks"
 * and "drinks" don't become two categories.
 */
async function findOrCreateCategory(organizationId: string, name: string): Promise<string> {
  const existing = await prisma.category.findFirst({
    where: { organizationId, name: { equals: name, mode: "insensitive" } },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await prisma.category.create({
    data: { organizationId, name },
    select: { id: true },
  });
  return created.id;
}

async function findOrCreateSupplier(organizationId: string, name: string): Promise<string> {
  const existing = await prisma.supplier.findFirst({
    where: { organizationId, name: { equals: name, mode: "insensitive" } },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await prisma.supplier.create({
    data: { organizationId, name, type: "MARKET" },
    select: { id: true },
  });
  return created.id;
}

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid row.";
  const field = issue.path.map(String).join(".");
  return field ? `${field}: ${issue.message}` : issue.message;
}

function rowErrorMessage(error: unknown): string {
  if (error instanceof AppError) return error.message;
  // Prisma unique-constraint on an import usually means a barcode or SKU already
  // belongs to a product that isn't in this chunk.
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  ) {
    return "A product with this barcode or SKU already exists.";
  }
  console.error("[products/import] row failed:", error);
  return "Couldn't save this row.";
}
