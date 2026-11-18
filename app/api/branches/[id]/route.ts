import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError, handle, readJson } from "@/lib/api";
import { requireTenantApi } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/permissions";
import { getSeatSummary, seatFullMessage, seatIsFull } from "@/lib/staff";

/**
 * Rename a branch, update its address, or close / reopen it.
 *
 * Closing is a switch, not a delete: the branch's sales and stock history stay
 * exactly where they are. Two things are refused because they would strand
 * people — closing the main branch, and closing a branch that still has active
 * staff assigned to it (they would sign in to a shop that no longer exists).
 */

const PatchSchema = z.object({
  name: z.string().trim().min(2, "Enter the branch name.").max(80).optional(),
  address: z
    .string()
    .trim()
    .max(240)
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v || null)),
  phone: z
    .string()
    .trim()
    .max(30)
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v || null)),
  isActive: z.boolean().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = await requireTenantApi();
    requirePermission(session.user, PERMISSIONS.SETTINGS_MANAGE);
    const { id } = await params;
    const input = PatchSchema.parse(await readJson(request));

    const branch = await prisma.$transaction(async (tx) => {
      const existing = await tx.branch.findFirst({
        where: { id, organizationId: session.org.id },
        select: { id: true, name: true, isMain: true, isActive: true },
      });
      if (!existing) throw new AppError("That branch no longer exists.", { status: 404 });

      const staffCount = await tx.user.count({
        where: { organizationId: session.org.id, branchId: id, isActive: true },
      });

      if (input.isActive === false && existing.isActive) {
        if (existing.isMain) {
          throw new AppError("The main branch can't be closed.");
        }
        if (staffCount > 0) {
          throw new AppError(
            `${staffCount} active staff ${staffCount === 1 ? "member is" : "members are"} assigned to this branch. Move or deactivate them first.`,
            { status: 409 },
          );
        }
      }
      if (input.isActive === true && !existing.isActive) {
        const seats = await getSeatSummary(tx, session.org.id, session.org.plan);
        if (seatIsFull(seats.branches)) {
          throw new AppError(seatFullMessage("branches", seats.branches), { status: 409 });
        }
      }

      const updated = await tx.branch.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.address !== undefined ? { address: input.address } : {}),
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
        select: { id: true, name: true, code: true, address: true, phone: true, isMain: true, isActive: true },
      });

      await tx.auditLog.create({
        data: {
          organizationId: session.org.id,
          userId: session.user.id,
          userName: session.user.name,
          action:
            input.isActive === false && existing.isActive
              ? "BRANCH_CLOSED"
              : input.isActive === true && !existing.isActive
                ? "BRANCH_REOPENED"
                : "BRANCH_EDITED",
          entity: "Branch",
          entityId: id,
          summary: `Changed branch ${existing.name}.`,
        },
      });

      return { ...updated, staffCount };
    });

    return NextResponse.json({ ok: true, branch });
  });
}
