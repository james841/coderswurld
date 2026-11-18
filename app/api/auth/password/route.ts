import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError, handle, readJson } from "@/lib/api";
import { hashPassword, requireTenantApi, verifyPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * POST /api/auth/password — change your own password.
 *
 * This is the only route that writes a password hash for the user making the
 * request, and it is deliberately the only way to clear `mustChangePassword`.
 * A provisioning or reset temp password is sent by email, which means it exists
 * in somebody's inbox forever; the account isn't really the owner's until it's
 * been replaced with something only they know.
 *
 * The current password is required even when `mustChangePassword` is set. The
 * person at the keyboard just typed it to get here, so it costs them nothing —
 * and it means a session left open on a shop counter can't be used to lock the
 * owner out of their own account.
 */

const Schema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password.").max(200),
    /**
     * bcrypt silently ignores anything past 72 bytes, so a 100-character
     * passphrase would have its tail quietly discarded and a different tail
     * would still log in. Reject it here instead of pretending it was stored.
     */
    newPassword: z
      .string()
      .min(8, "Use at least 8 characters.")
      .max(72, "Use 72 characters or fewer."),
    confirmPassword: z.string().min(1, "Type the new password again."),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: "The two passwords don't match.",
    path: ["confirmPassword"],
  })
  .refine((value) => value.newPassword !== value.currentPassword, {
    message: "That's the password you're already using.",
    path: ["newPassword"],
  });

export async function POST(request: Request) {
  return handle(async () => {
    // `allowLocked` is not passed, but this route is reachable from the
    // `/change-password` gate, which renders outside the app shell — a user with
    // a temp password on a healthy account. A suspended business is turned away
    // by `requireTenantApi` like everywhere else.
    const session = await requireTenantApi();
    const payload = Schema.parse(await readJson(request));

    const user = await prisma.user.findFirst({
      // organizationId in the WHERE, as everywhere: a token minted for one
      // business can never touch another's user row.
      where: { id: session.user.id, organizationId: session.org.id },
      select: { id: true, name: true, passwordHash: true },
    });
    if (!user) throw new AppError("Your account no longer exists.", { status: 401 });

    const ok = await verifyPassword(payload.currentPassword, user.passwordHash);
    if (!ok) {
      throw new AppError("That current password isn't right.", {
        status: 422,
        fields: { currentPassword: "That current password isn't right." },
      });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(payload.newPassword),
        mustChangePassword: false,
      },
    });

    // The audit row is the record of *when* this happened — there's deliberately
    // no `passwordChangedAt` column duplicating it. The summary says what
    // happened, never what it was changed to.
    await prisma.auditLog
      .create({
        data: {
          organizationId: session.org.id,
          userId: user.id,
          userName: user.name,
          action: "PASSWORD_CHANGED",
          entity: "User",
          entityId: user.id,
          summary: `${user.name} changed their own password.`,
        },
      })
      .catch((error) => {
        console.error("[auth/password] audit write failed:", error);
      });

    return NextResponse.json({ ok: true });
  });
}
