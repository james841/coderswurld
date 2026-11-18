import { NextResponse, type NextRequest } from "next/server";

import { verifyToken } from "@/lib/auth";

/**
 * Next 16 renamed `middleware.ts` to `proxy.ts` and the exported function from
 * `middleware` to `proxy`. It runs on the Node.js runtime now, not the edge.
 *
 * SCOPE DISCIPLINE
 * ----------------
 * This file does exactly one thing: bounce anonymous requests away from
 * protected URL trees, and bounce signed-in ones away from the sign-in pages.
 * It verifies the cookie signature only — no database, no permission checks.
 *
 * Even though Node runtime means Prisma *would* work here, a query in the proxy
 * runs on every navigation including prefetches, and prefetch storms are the
 * usual cause of a mysteriously slow app. Real authorisation (is the account
 * active? does this user hold `pos.sell`?) happens in the layouts and route
 * handlers via `requireTenant()` / `requirePermission()`, where the result is
 * cached per request.
 *
 * The POS tree is deliberately NOT gated here: it must keep rendering from the
 * service-worker cache when the shop's internet drops, and a proxy redirect
 * would break that. Its layout guards it instead.
 */

/** URL trees that require a tenant session. */
const TENANT_PREFIXES = [
  "/dashboard",
  "/products",
  "/stock",
  "/sales",
  "/customers",
  "/suppliers",
  "/purchases",
  "/receipts",
  "/expenses",
  "/reports",
  "/staff",
  "/settings",
  "/pos",
  "/launch",
  // The forced password gate. It sits outside the app shell — otherwise the
  // layout that redirects here would redirect away from here too — but it is
  // still a signed-in page, and an anonymous visitor belongs at /signin.
  "/change-password",
];

/** URL trees that require the platform (universal) session. */
const PLATFORM_PREFIX = "/platform";

function startsWithSegment(pathname: string, prefix: string): boolean {
  // Match "/products" and "/products/add" but never "/products-archive".
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // ── Platform console ──────────────────────────────────────────────────────
  if (startsWithSegment(pathname, PLATFORM_PREFIX)) {
    const isSignIn = pathname === "/platform/signin";
    const token = request.cookies.get("cw_platform")?.value;
    const claims = token ? await verifyToken(token) : null;
    const signedIn = claims?.typ === "platform";

    if (!signedIn && !isSignIn) {
      const url = request.nextUrl.clone();
      url.pathname = "/platform/signin";
      // Preserve where they were going so the form can send them back.
      url.search = pathname === "/platform" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
      return NextResponse.redirect(url);
    }
    // A signed-in operator landing on /platform/signin is bounced onward by the
    // page itself, not here — the page can honour ?next=, this can't do it
    // safely without re-implementing the same-origin check.
    return NextResponse.next();
  }

  // ── Tenant app ────────────────────────────────────────────────────────────
  const needsTenant = TENANT_PREFIXES.some((p) => startsWithSegment(pathname, p));

  if (needsTenant) {
    const token = request.cookies.get("cw_session")?.value;
    const claims = token ? await verifyToken(token) : null;

    if (claims?.typ !== "tenant") {
      const url = request.nextUrl.clone();
      url.pathname = "/signin";
      url.search = `?next=${encodeURIComponent(pathname + search)}`;
      return NextResponse.redirect(url);
    }
  }

  // /signin is intentionally not handled here. The page reads the session
  // anyway, and only it knows whether to send the user to /pos, /dashboard or
  // /locked — a blanket redirect to /dashboard here would send every cashier to
  // a screen they can't read and drop the ?next= they arrived with.
  return NextResponse.next();
}

export const config = {
  /**
   * Skip everything that can never need an auth decision. Notably `_next/*`
   * and the uploads folder: running this on every image request would add a
   * signature verification to each product tile the POS paints.
   */
  matcher: [
    "/((?!_next/static|_next/image|uploads/|brand/|icons/|favicon.ico|manifest.webmanifest|sw.js|robots.txt|sitemap.xml).*)",
  ],
};
