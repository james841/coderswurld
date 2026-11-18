import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError, handle, readJson } from "@/lib/api";
import { requireTenantApi } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/permissions";
import { deriveBranchCode } from "@/lib/provision";
import { getSeatSummary, seatFullMessage, seatIsFull } from "@/lib/staff";

/**
 * Open a new branch.
 *
 * A branch's CODE is the prefix on every receipt it prints (IKJ-000148), so it
 * is chosen once here and never changes: renumbering a shop's receipts halfway
 * through the year would break every reference a customer or an auditor holds.
 * The name can change freely.
 */

const CreateSchema = z.object({
  name: z.string().trim().min(2, "Enter the branch name.").max(80),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,4}$/, "2 to 4 letters or numbers.")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  address: z
    .string()
    .trim()
    .max(240)
    .optional()
    .transform((v) => v || null),
  phone: z
    .string()
    .trim()
    .max(30)
    .optional()
    .transform((v) => v || null),
});

export async function POST(request: Request) {
  return handle(async () => {
    const session = await requireTenantApi();
    requirePermission(session.user, PERMISSIONS.SETTINGS_MANAGE);

    const input = CreateSchema.parse(await readJson(request));

    const branch = await prisma.$transaction(async (tx) => {
      const seats = await getSeatSummary(tx, session.org.id, session.org.plan);
      if (seatIsFull(seats.branches)) {
        throw new AppError(seatFullMessage("branches", seats.branches), { status: 409 });
      }

      const taken = new Set(
        (
          await tx.branch.findMany({
            where: { organizationId: session.org.id },
            select: { code: true },
          })
        ).map((b) => b.code),
      );

      let code = input.code;
      if (code) {
        if (taken.has(code)) {
          throw new AppError("Another branch already uses that code.", {
            status: 409,
            fields: { code: "Already in use" },
          });
        }
      } else {
        // Suggest from the name; on a clash, number it: IKJ, IK2, IK3…
        const base = deriveBranchCode(input.name);
        code = base;
        for (let n = 2; taken.has(code) && n < 100; n += 1) {
          code = `${base.slice(0, 2)}${n}`;
        }
        if (taken.has(code)) {
          throw new AppError("Type a short code for this branch.", {
            fields: { code: "Needed" },
          });
        }
      }

      const created = await tx.branch.create({
        data: {
          organizationId: session.org.id,
          name: input.name,
          code,
          address: input.address,
          phone: input.phone,
        },
        select: { id: true, name: true, code: true, address: true, phone: true, isMain: true, isActive: true },
      });

      await tx.auditLog.create({
        data: {
          organizationId: session.org.id,
          userId: session.user.id,
          userName: session.user.name,
          action: "BRANCH_ADDED",
          entity: "Branch",
          entityId: created.id,
          summary: `Opened branch ${created.name} (${created.code}).`,
        },
      });

      return created;
    });

    return NextResponse.json({ ok: true, branch: { ...branch, staffCount: 0 } }, { status: 201 });
  });
}
