import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";

import { prisma } from "./db";
import { effectivePermissions } from "./permissions";
import { SEES_ALL_DEPARTMENTS, isDepartment, type Department, type Permission } from "./constants";

/**
 * Authentication.
 *
 * Two independent session cookies, deliberately separate:
 *
 *   cw_platform  — you, the platform operator. Scoped to /platform.
 *   cw_session   — a tenant user (main admin, sub-admin, cashier…).
 *
 * Separate cookies mean you can be signed into your own universal dashboard
 * and into a customer's tenant at the same time while supporting them, without
 * one login knocking out the other.
 *
 * WHY THE TOKEN IS THIN
 * ---------------------
 * The JWT carries only ids — never the role, never the permission list. Every
 * request re-reads the user and organization from the database (one indexed
 * primary-key lookup, de-duplicated per request by React `cache()`).
 *
 * That costs a sub-millisecond query and buys three things that matter more:
 *   • A main admin revoking a sub-admin's access takes effect on the next
 *     click, not whenever the cookie happens to expire.
 *   • Suspending an organization for non-payment locks it out immediately.
 *   • Deactivating a sacked cashier actually logs them out.
 *
 * A fat JWT would make all three of those silently not work, which is exactly
 * the class of bug you discover during an incident.
 */

const TENANT_COOKIE = "cw_session";
const PLATFORM_COOKIE = "cw_platform";

/** 12 hours. A shop opens and closes; a till session should not outlive the day. */
const TENANT_MAX_AGE_SECONDS = 60 * 60 * 12;
/** 8 hours for the platform console. */
const PLATFORM_MAX_AGE_SECONDS = 60 * 60 * 8;

const ISSUER = "coderswurld-inventory";

function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "AUTH_SECRET is missing or shorter than 32 characters. Set it in .env — " +
        'generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"',
    );
  }
  return new TextEncoder().encode(secret);
}

// ─────────────────────────────────────────────────────────────────────────────
// Passwords and PINs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 10 rounds, not the more fashionable 12. A cashier PIN check happens at the
 * till while a customer waits; 12 rounds is ~250ms on the low-end Windows
 * machines these shops run, 10 is ~60ms. Still far beyond brute-forceable for
 * a hash that never leaves the server.
 */
const BCRYPT_ROUNDS = 10;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(
  plain: string,
  hash: string | null | undefined,
): Promise<boolean> {
  if (!hash) {
    // Still burn the time. Returning early on a missing hash leaks, via response
    // timing, whether an email exists in the system.
    await bcrypt.hash(plain, BCRYPT_ROUNDS);
    return false;
  }
  return bcrypt.compare(plain, hash);
}

export const hashPin = hashPassword;
export const verifyPin = verifyPassword;

/** Readable, unambiguous temporary password for provisioning emails. */
export function generateTempPassword(): string {
  // No O/0, I/l/1 — these get misread off a phone screen and generate support
  // calls that all sound like "the password you sent doesn't work".
  const upper = "ABCDEFGHJKMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const digits = "23456789";
  const pool = upper + lower + digits;
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < 10; i++) out += pool[bytes[i] % pool.length];
  // Guarantee one of each class so it survives any password policy.
  return (
    upper[bytes[10] % upper.length] +
    out +
    digits[bytes[11] % digits.length]
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Token issue / verify
// ─────────────────────────────────────────────────────────────────────────────

interface TenantTokenClaims {
  typ: "tenant";
  sub: string; // User.id
  org: string; // Organization.id
  br?: string; // Branch.id the user is operating from
}

interface PlatformTokenClaims {
  typ: "platform";
  sub: string; // PlatformAdmin.id
}

type TokenClaims = TenantTokenClaims | PlatformTokenClaims;

async function signToken(claims: TokenClaims, maxAgeSeconds: number) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setIssuedAt(now)
    .setExpirationTime(now + maxAgeSeconds)
    .sign(secretKey());
}

/**
 * Verify a token's signature and shape. Exported because `proxy.ts` uses it to
 * decide redirects without touching the database.
 */
export async function verifyToken(token: string): Promise<TokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: ISSUER,
      algorithms: ["HS256"],
    });
    if (payload.typ === "tenant") {
      if (typeof payload.sub !== "string" || typeof payload.org !== "string") {
        return null;
      }
      return {
        typ: "tenant",
        sub: payload.sub,
        org: payload.org,
        br: typeof payload.br === "string" ? payload.br : undefined,
      };
    }
    if (payload.typ === "platform" && typeof payload.sub === "string") {
      return { typ: "platform", sub: payload.sub };
    }
    return null;
  } catch {
    // Expired, tampered, or signed with a rotated secret. All the same to us.
    return null;
  }
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    // Never `secure: true` in dev — the cookie would be silently dropped over
    // plain http://localhost and login would appear to "do nothing".
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cookie writers — call these from server actions / route handlers only
// ─────────────────────────────────────────────────────────────────────────────

export async function startTenantSession(params: {
  userId: string;
  organizationId: string;
  branchId?: string | null;
}) {
  const token = await signToken(
    {
      typ: "tenant",
      sub: params.userId,
      org: params.organizationId,
      br: params.branchId ?? undefined,
    },
    TENANT_MAX_AGE_SECONDS,
  );
  const jar = await cookies();
  jar.set(TENANT_COOKIE, token, cookieOptions(TENANT_MAX_AGE_SECONDS));
}

export async function startPlatformSession(platformAdminId: string) {
  const token = await signToken(
    { typ: "platform", sub: platformAdminId },
    PLATFORM_MAX_AGE_SECONDS,
  );
  const jar = await cookies();
  jar.set(PLATFORM_COOKIE, token, cookieOptions(PLATFORM_MAX_AGE_SECONDS));
}

export async function endTenantSession() {
  const jar = await cookies();
  jar.delete(TENANT_COOKIE);
}

export async function endPlatformSession() {
  const jar = await cookies();
  jar.delete(PLATFORM_COOKIE);
}

// ─────────────────────────────────────────────────────────────────────────────
// Session readers
// ─────────────────────────────────────────────────────────────────────────────

export interface TenantSession {
  user: {
    id: string;
    name: string;
    email: string | null;
    role: string;
    permissions: Permission[];
    mustChangePassword: boolean;
    /**
     * The one department this person is limited to, or null for both.
     * Already resolved: null whenever the shop has departments off, or the
     * person is an admin or manager. Use it directly as a filter.
     */
    department: Department | null;
  };
  org: {
    id: string;
    name: string;
    slug: string;
    plan: string;
    status: string;
    currency: string;
    timezone: string;
    catalogVersion: number;
    logoUrl: string | null;
  };
  branch: {
    id: string;
    name: string;
    code: string;
  } | null;
  /** True when the organization is not ACTIVE, or its subscription has lapsed. */
  locked: boolean;
  lockReason: string | null;
  expiresAt: Date | null;
}

export interface PlatformSession {
  id: string;
  name: string;
  email: string | null;
}

/**
 * The current tenant session, or null.
 *
 * Wrapped in `cache()` so a page that calls it in the layout, the page body and
 * three components still issues exactly one query per request.
 */
export const getTenantSession = cache(
  async (): Promise<TenantSession | null> => {
    const jar = await cookies();
    const token = jar.get(TENANT_COOKIE)?.value;
    if (!token) return null;

    const claims = await verifyToken(token);
    if (!claims || claims.typ !== "tenant") return null;

    const user = await prisma.user.findFirst({
      // organizationId is in the WHERE, not just the token: a token minted for
      // one org can never be used to read a user in another.
      where: { id: claims.sub, organizationId: claims.org, isActive: true },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        permissions: true,
        mustChangePassword: true,
        department: true,
        organization: {
          select: {
            settings: { select: { departmentsEnabled: true } },
            id: true,
            name: true,
            slug: true,
            plan: true,
            status: true,
            currency: true,
            timezone: true,
            catalogVersion: true,
            logoUrl: true,
            subscriptions: {
              where: { status: "ACTIVE" },
              orderBy: { expiresAt: "desc" },
              take: 1,
              select: { expiresAt: true },
            },
          },
        },
        branch: { select: { id: true, name: true, code: true, isActive: true } },
      },
    });

    if (!user) return null;

    const org = user.organization;
    const expiresAt = org.subscriptions[0]?.expiresAt ?? null;

    // Belt and braces: an expiry sweep that failed to run overnight must not
    // hand a lapsed customer another free day of trading.
    let locked = false;
    let lockReason: string | null = null;
    if (org.status === "PENDING") {
      locked = true;
      lockReason = "This account has not been activated yet.";
    } else if (org.status === "SUSPENDED") {
      locked = true;
      lockReason = "This account has been suspended. Please contact Coderswurld.";
    } else if (org.status === "EXPIRED") {
      locked = true;
      lockReason = "Your subscription has expired. Please renew to continue.";
    } else if (expiresAt && expiresAt.getTime() < Date.now()) {
      locked = true;
      lockReason = "Your subscription has expired. Please renew to continue.";
    }

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        permissions: effectivePermissions(user.role, user.permissions),
        mustChangePassword: user.mustChangePassword,
        department:
          org.settings?.departmentsEnabled &&
          !SEES_ALL_DEPARTMENTS.includes(user.role) &&
          isDepartment(user.department)
            ? user.department
            : null,
      },
      org: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        plan: org.plan,
        status: org.status,
        currency: org.currency,
        timezone: org.timezone,
        catalogVersion: org.catalogVersion,
        logoUrl: org.logoUrl,
      },
      branch:
        user.branch && user.branch.isActive
          ? { id: user.branch.id, name: user.branch.name, code: user.branch.code }
          : null,
      locked,
      lockReason,
      expiresAt,
    };
  },
);

export const getPlatformSession = cache(
  async (): Promise<PlatformSession | null> => {
    const jar = await cookies();
    const token = jar.get(PLATFORM_COOKIE)?.value;
    if (!token) return null;

    const claims = await verifyToken(token);
    if (!claims || claims.typ !== "platform") return null;

    const admin = await prisma.platformAdmin.findFirst({
      where: { id: claims.sub, isActive: true },
      select: { id: true, name: true, email: true },
    });
    return admin ?? null;
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Guards
// ─────────────────────────────────────────────────────────────────────────────

/** Thrown by the `require*` helpers in API routes. Mapped to 401 by lib/api.ts. */
export class AuthError extends Error {
  readonly status = 401;
  constructor(message = "You are not signed in.") {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * For Server Components. Redirects to the sign-in page when absent.
 *
 * `allowLocked` exists so the billing / renewal screen can still render for a
 * suspended organization — locking a customer out of the page that tells them
 * how to pay you is a self-inflicted wound.
 */
export async function requireTenant(options?: {
  allowLocked?: boolean;
}): Promise<TenantSession> {
  const session = await getTenantSession();
  if (!session) redirect("/signin");
  if (session.locked && !options?.allowLocked) redirect("/locked");
  return session;
}

export async function requirePlatform(): Promise<PlatformSession> {
  const session = await getPlatformSession();
  if (!session) redirect("/platform/signin");
  return session;
}

/** For route handlers: throws instead of redirecting (a fetch can't follow a redirect to HTML). */
export async function requireTenantApi(): Promise<TenantSession> {
  const session = await getTenantSession();
  if (!session) throw new AuthError();
  if (session.locked) {
    throw new AuthError(session.lockReason ?? "This account is not active.");
  }
  return session;
}

export async function requirePlatformApi(): Promise<PlatformSession> {
  const session = await getPlatformSession();
  if (!session) throw new AuthError();
  return session;
}
