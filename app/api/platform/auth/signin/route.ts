import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError, handle, readJson } from "@/lib/api";
import { prisma } from "@/lib/db";
import { startPlatformSession, verifyPassword } from "@/lib/auth";
import { clearRateLimit, clientIp, rateLimit } from "@/lib/rateLimit";

/**
 * POST /api/platform/auth/signin — the universal (platform operator) console.
 *
 * Throttled harder than the tenant login. There are a handful of platform
 * accounts in existence and they hold the keys to every customer's data, so a
 * password-spraying script gets five tries per half hour, not eight per ten
 * minutes.
 */

const SignInSchema = z.object({
  email: z.string().trim().toLowerCase().min(1, "Enter your email address.").max(160),
  password: z.string().min(1, "Enter your password.").max(200),
});

const LIMIT = { limit: 5, windowMs: 30 * 60 * 1000 };

export async function POST(request: Request) {
  return handle(async () => {
    const { email, password } = SignInSchema.parse(await readJson(request));

    const ip = clientIp(request);
    const emailKey = `platform-signin:email:${email}`;
    const byEmail = rateLimit(emailKey, LIMIT);
    const byIp = rateLimit(`platform-signin:ip:${ip}`, LIMIT);
    if (!byEmail.ok || !byIp.ok) {
      const wait = Math.max(byEmail.retryAfterSeconds, byIp.retryAfterSeconds);
      throw new AppError(
        `Too many attempts. Try again in ${Math.ceil(wait / 60)} minutes.`,
        { status: 429 },
      );
    }

    const admin = await prisma.platformAdmin.findUnique({
      where: { email },
      select: { id: true, passwordHash: true, isActive: true },
    });

    // Verify unconditionally — an early return on a missing row leaks, through
    // response timing, which addresses are real platform accounts.
    const ok = await verifyPassword(password, admin?.isActive ? admin.passwordHash : null);
    if (!admin || !admin.isActive || !ok) {
      throw new AppError("That email or password is not correct.", {
        status: 401,
        fields: { password: "Incorrect" },
      });
    }

    clearRateLimit(emailKey);
    await startPlatformSession(admin.id);
    await prisma.platformAdmin
      .update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } })
      .catch(() => undefined);

    return NextResponse.json({ ok: true, redirectTo: "/platform" });
  });
}
