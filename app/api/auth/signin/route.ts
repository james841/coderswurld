import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError, handle, readJson } from "@/lib/api";
import { prisma } from "@/lib/db";
import { startTenantSession, verifyPassword } from "@/lib/auth";
import { toLoginName } from "@/lib/loginName";
import { clearRateLimit, clientIp, rateLimit } from "@/lib/rateLimit";

/**
 * POST /api/auth/signin — tenant sign-in (main admin, sub-admin, cashier…).
 *
 * WHY THERE IS NO "SHOP CODE" FIELD
 * ---------------------------------
 * Email is unique *per organization*, not globally, so in principle the same
 * address could belong to two different shops. Asking every cashier to also
 * remember an organization code to cover a case that will almost never happen
 * is exactly the kind of friction this product exists to remove.
 *
 * So: look up every active user with that email, verify the password against
 * each, and sign in the single match. In the rare collision where the password
 * matches in more than one organization, return 409 with the list so the client
 * can show a picker and re-post with `organizationId`.
 *
 * The password is verified against every candidate rather than short-circuiting
 * on the first match, so response time doesn't reveal how many organizations an
 * address appears in.
 */

const SignInSchema = z.object({
  /**
   * An email, or the person's name as the shop wrote it on their staff record
   * (any letter case). `email` is still accepted from older clients.
   */
  login: z.string().trim().max(160).optional(),
  email: z.string().trim().max(160).optional(),
  password: z.string().min(1, "Enter your password.").max(200),
  /** Set by the client only after a 409 collision response. */
  organizationId: z.string().trim().max(40).optional(),
});

/** 8 failed attempts per 10 minutes, counted per email and per IP separately. */
const LIMIT = { limit: 8, windowMs: 10 * 60 * 1000 };

/**
 * One deliberately vague message for "no such user", "wrong password" and
 * "wrong organization". Naming which one it was tells an attacker which email
 * addresses are worth attacking.
 */
const BAD_CREDENTIALS = "That name, email or password is not correct.";

export async function POST(request: Request) {
  return handle(async () => {
    const parsed = SignInSchema.parse(await readJson(request));
    const { password, organizationId } = parsed;
    const raw = (parsed.login || parsed.email || "").trim();
    if (!raw) {
      throw new AppError("Enter your email or your name.", { fields: { login: "Required" } });
    }
    // Anything with an @ is an email; anything else is a name.
    const byEmailLogin = raw.includes("@");
    const email = byEmailLogin ? raw.toLowerCase() : toLoginName(raw);

    const ip = clientIp(request);
    const emailKey = `signin:email:${email}`;
    const ipKey = `signin:ip:${ip}`;

    const byEmail = rateLimit(emailKey, LIMIT);
    const byIp = rateLimit(ipKey, { limit: 30, windowMs: LIMIT.windowMs });
    if (!byEmail.ok || !byIp.ok) {
      const wait = Math.max(byEmail.retryAfterSeconds, byIp.retryAfterSeconds);
      throw new AppError(
        `Too many sign-in attempts. Please wait ${Math.ceil(wait / 60)} minute${
          wait > 60 ? "s" : ""
        } and try again.`,
        { status: 429 },
      );
    }

    const candidates = await prisma.user.findMany({
      where: {
        ...(byEmailLogin ? { email } : { loginName: email }),
        isActive: true,
        ...(organizationId ? { organizationId } : {}),
      },
      select: {
        id: true,
        passwordHash: true,
        role: true,
        branchId: true,
        mustChangePassword: true,
        organizationId: true,
        organization: {
          select: { id: true, name: true, slug: true, status: true },
        },
      },
      // A collision is pathological; cap it so a poisoned row can't make login
      // run bcrypt fifty times.
      take: 5,
    });

    if (candidates.length === 0) {
      // Burn a comparable amount of time so a missing account and a wrong
      // password are indistinguishable from the outside.
      await verifyPassword(password, null);
      throw new AppError(BAD_CREDENTIALS, { status: 401, fields: { password: "Incorrect" } });
    }

    const matched: typeof candidates = [];
    for (const candidate of candidates) {
      if (await verifyPassword(password, candidate.passwordHash)) {
        matched.push(candidate);
      }
    }

    if (matched.length === 0) {
      throw new AppError(BAD_CREDENTIALS, { status: 401, fields: { password: "Incorrect" } });
    }

    if (matched.length > 1) {
      return NextResponse.json(
        {
          error: `This ${byEmailLogin ? "email" : "name"} is used at more than one business. Choose which one.`,
          organizations: matched.map((m) => ({
            id: m.organization.id,
            name: m.organization.name,
          })),
        },
        { status: 409 },
      );
    }

    const user = matched[0];

    // The password was right, so this person is not an attacker — clear their
    // strikes before anything else can fail.
    clearRateLimit(emailKey);

    await startTenantSession({
      userId: user.id,
      organizationId: user.organizationId,
      branchId: user.branchId,
    });

    // Best-effort: a failed timestamp write must not fail a login.
    await prisma.user
      .update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
      .catch(() => undefined);

    return NextResponse.json({
      ok: true,
      // Where to go next. Computed here because the server already knows the
      // role and the organization's status — the client shouldn't have to guess.
      redirectTo: nextDestination(user.role, user.organization.status, user.mustChangePassword),
      mustChangePassword: user.mustChangePassword,
    });
  });
}

/**
 * A cashier's home is the till, not the dashboard. Sending them to a screen of
 * profit figures they have no permission to read, so they can then click through
 * to the till, is a hundred wasted seconds every single morning.
 */
function nextDestination(
  role: string,
  orgStatus: string,
  mustChangePassword: boolean,
): string {
  if (orgStatus !== "ACTIVE") return "/locked";
  if (mustChangePassword) return "/change-password";
  if (role === "CASHIER") return "/pos";
  return "/dashboard";
}
