import { requirePlatform } from "@/lib/auth";
import { PlatformNav } from "../PlatformNav";

/**
 * The platform console shell.
 *
 * `requirePlatform()` runs here, once, for every page in this tree. The proxy
 * already bounced anonymous requests; this is the real check — the proxy only
 * verified a signature, this verifies the admin still exists and is active.
 *
 * It lives in the `(console)` route group rather than at `app/platform/` so it
 * does NOT wrap `/platform/signin`. Wrapping the sign-in page in a layout that
 * redirects unauthenticated users *to* the sign-in page is an infinite loop.
 */

/**
 * Never cache any console page.
 *
 * `requirePlatform()` reads a cookie, which already forces every page in this
 * tree to render per request — but that is a side effect, not a promise. Stating
 * it outright means a page that later stops depending on the session cannot
 * quietly become static and start showing the operator yesterday's renewals, or
 * an account status that changed an hour ago.
 */
export const dynamic = "force-dynamic";

export default async function PlatformConsoleLayout({
  children,
}: LayoutProps<"/platform">) {
  const session = await requirePlatform();

  return (
    <div className="min-h-dvh bg-canvas">
      <PlatformNav operatorName={session.name} />
      <div className="flex min-h-dvh flex-col lg:pl-64">
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:py-8">{children}</main>
        <footer className="border-t border-hairline py-4">
          <p className="mx-auto max-w-7xl px-4 text-xs text-ink-400 sm:px-6">
            Coderswurld platform console. Every action here affects live customer data.
          </p>
        </footer>
      </div>
    </div>
  );
}
