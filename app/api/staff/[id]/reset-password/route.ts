import { NextResponse } from "next/server";

import { AppError, handle } from "@/lib/api";
import { generateTempPassword, hashPassword, requireTenantApi } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canManageUser } from "@/lib/permissions";

/**
 * "I forgot my password" for someone on the shop floor.
 *
 * Cashiers often have no working email on their phone, so there is no reset
 * link to send. Their manager resets it here instead: the server makes a new
 * temporary password, shows it once, and the person must choose their own the
 * next time they sign in. The old password stops working immediately.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = await requireTenantApi();
    const { id } = await params;

    const target = await prisma.user.findFirst({
      where: { id, organizationId: session.org.id },
      select: { id: true, name: true, role: true, isActive: true },
    });
    if (!target) throw new AppError("That person is no longer on your staff.", { status: 404 });

    const verdict = canManageUser(session.user, target);
    if (!verdict.allowed) {
      throw new AppError(
        target.id === session.user.id
          ? "To change your own password, use Change password in the menu."
          : (verdict.reason ?? "You can't reset this person's password."),
        { status: 403 },
      );
    }
    if (!target.isActive) {
      throw new AppError("Reactivate this person before resetting their password.");
    }

    const tempPassword = generateTempPassword();
    const passwordHash = await hashPassword(tempPassword);

    await prisma.$transaction([
      prisma.user.update({
        where: { id },
        data: { passwordHash, mustChangePassword: true },
      }),
      prisma.auditLog.create({
        data: {
          organizationId: session.org.id,
          userId: session.user.id,
          userName: session.user.name,
          action: "STAFF_PASSWORD_RESET",
          entity: "User",
          entityId: id,
          summary: `Reset the password for ${target.name}.`,
        },
      }),
    ]);

    return NextResponse.json(
      { ok: true, tempPassword },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
