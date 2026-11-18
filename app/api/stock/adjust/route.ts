import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError, handle, readJson } from "@/lib/api";
import { prisma } from "@/lib/db";
import { requireTenantApi } from "@/lib/auth";
import { requirePermission } from "@/lib/permissions";
import { PERMISSIONS } from "@/lib/constants";
import { applyMovement, applyRecount } from "@/lib/stock";
import { nextAdjustmentNumber } from "@/lib/sequence";

/**
 * POST /api/stock/adjust — change one product's on-hand figure by hand.
 *
 * Two shapes of the same intent, told apart by `mode`:
 *
 *   • "recount"  — the manager counted the shelf and there are 43. We don't ask
 *                  them to work out the difference; `applyRecount` writes the
 *                  delta so the ledger still reads as a signed movement.
 *   • "adjust"   — a known event moved stock outside a sale or a purchase: three
 *                  cartons were damaged, a bag expired, a miscount is being
 *                  corrected. The caller gives the magnitude and the reason sets
 *                  the sign and the movement type.
 *
 * Both write to the append-only ledger inside one transaction (see lib/stock).
 * Neither touches the catalogue version: moving stock never changes what the till
 * knows about a product, only how many of it there are — the till picks that up
 * through the stock cursor, not a catalogue sync.
 */

const MAX_QTY = 1_000_000;

/** Each adjustment reason carries its own direction and ledger type. */
const ADJUST_TYPES = ["DAMAGE", "EXPIRED", "ADJUSTMENT"] as const;

const RecountSchema = z.object({
  mode: z.literal("recount"),
  productId: z.string().min(1),
  branchId: z.string().min(1).optional(),
  countedQuantity: z
    .number()
    .min(0, "A count can't be negative.")
    .max(MAX_QTY, "That count is too large."),
  reason: z.string().trim().max(300).optional(),
});

const AdjustSchema = z.object({
  mode: z.literal("adjust"),
  productId: z.string().min(1),
  branchId: z.string().min(1).optional(),
  // Signed: +5 found, -3 damaged. The client derives the sign from the reason.
  quantity: z
    .number()
    .refine((n) => n !== 0, "Enter how many to add or remove.")
    .refine((n) => Math.abs(n) <= MAX_QTY, "That quantity is too large."),
  type: z.enum(ADJUST_TYPES),
  reason: z.string().trim().max(300).optional(),
  // Stock being added can carry its own batch and expiry.
  batchNo: z.string().trim().max(60).optional().nullable(),
  expiryDate: z.coerce.date().optional().nullable(),
});

const BodySchema = z.discriminatedUnion("mode", [RecountSchema, AdjustSchema]);

export async function POST(request: Request) {
  return handle(async () => {
    const session = await requireTenantApi();
    requirePermission(session.user, PERMISSIONS.STOCK_ADJUST);
    const orgId = session.org.id;

    const input = BodySchema.parse(await readJson(request));

    // A branch has to be concrete to move stock — an org-wide admin picks one on
    // the page; a branch-scoped user inherits theirs from the session.
    const branchId = input.branchId ?? session.branch?.id ?? null;
    if (!branchId) {
      throw new AppError("Choose which branch you're counting.", {
        status: 400,
        fields: { branch: "Pick a branch" },
      });
    }

    // Both the branch and the product must belong to the caller's org. Ids are
    // cuids in the URL/body, not secrets — this is the check that stops a crafted
    // id from reaching across tenants.
    const [branch, product] = await Promise.all([
      prisma.branch.findFirst({
        where: { id: branchId, organizationId: orgId },
        select: { id: true },
      }),
      prisma.product.findFirst({
        where: { id: input.productId, organizationId: orgId },
        select: { id: true, name: true, unit: true },
      }),
    ]);
    if (!branch) throw new AppError("That branch no longer exists.", { status: 404 });
    if (!product) throw new AppError("That product no longer exists.", { status: 404 });

    if (input.mode === "recount") {
      const result = await prisma.$transaction((tx) =>
        applyRecount(tx, {
          organizationId: orgId,
          branchId,
          productId: product.id,
          countedQuantity: input.countedQuantity,
          reason: input.reason || "Physical count",
          userId: session.user.id,
        }),
      );

      // applyRecount returns null when the count already matched — nothing was
      // written, and that's the honest answer to send back.
      if (!result) {
        return NextResponse.json({
          ok: true,
          changed: false,
          delta: 0,
          balance: input.countedQuantity,
        });
      }
      return NextResponse.json({
        ok: true,
        changed: true,
        delta: result.delta,
        balance: result.balance,
      });
    }

    // mode === "adjust"
    const { balance, reference } = await prisma.$transaction(async (tx) => {
      const reference = await nextAdjustmentNumber(tx, orgId);
      const balance = await applyMovement(
        tx,
        {
          organizationId: orgId,
          branchId,
          productId: product.id,
          quantity: input.quantity,
          type: input.type,
          referenceType: "MANUAL",
          referenceId: reference,
          reason: input.reason || null,
          userId: session.user.id,
          batch:
            input.quantity > 0 && (input.batchNo || input.expiryDate)
              ? { batchNo: input.batchNo || null, expiryDate: input.expiryDate ?? null, source: "ADJUSTMENT" }
              : null,
        },
        // A removal must not drive stock below zero — you can't damage more than
        // you hold. applyMovement throws a StockError the wrapper turns into a 400.
        { allowNegative: false },
      );
      return { balance, reference };
    });

    return NextResponse.json({
      ok: true,
      changed: true,
      delta: input.quantity,
      balance,
      reference,
    });
  });
}
