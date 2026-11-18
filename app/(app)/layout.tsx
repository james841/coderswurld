import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { requireTenant } from "@/lib/auth";
import { countUnreadNotifications } from "@/lib/notifications";
import { AppShell } from "./AppShell";

/**
 * The admin shell's layout — the auth gate for every page in the business
 * back-office.
 *
 * The proxy already bounced requests with no cookie, but that only verified a
 * signature. This is the real check: it reads the user and the organization on
 * every request, so deactivating a staff member or suspending a business takes
 * effect on their very next click rather than whenever their 12-hour token
 * happens to expire. `requireTenant()` sends a suspended or lapsed account to
 * `/locked` and an unauthenticated one to `/signin`.
 *
 * It lives in the `(app)` route group so that it wraps only these pages — not
 * `/signin`, not `/locked`, and not `/change-password`, each of which has to
 * render for a user this layout would redirect away.
 */

/**
 * Never cache an admin page.
 *
 * `requireTenant()` reads a cookie, which already forces per-request rendering
 * — but that's a side effect, not a promise. Saying it outright means a page
 * that later stops touching the session can't quietly go static and start
 * serving one shop's stock figures to another's staff.
 */
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireTenant();

  // A temporary password is a gate, not a preference. Everything in this tree
  // is off-limits until it's replaced — including, deliberately, the till.
  if (session.user.mustChangePassword) {
    redirect("/change-password");
  }

  const unread = await countUnreadNotifications(session.org.id, session.user);
  // Read on the server so the page arrives already in the right theme, with no
  // white flash before switching to dark.
  const theme = (await cookies()).get("cw-theme")?.value === "dark" ? "dark" : "light";

  return (
    <AppShell
      user={{
        name: session.user.name,
        role: session.user.role,
        permissions: session.user.permissions,
      }}
      orgName={session.org.name}
      branchName={session.branch?.name ?? null}
      unreadNotifications={unread}
      initialTheme={theme}
    >
      {children}
    </AppShell>
  );
}
