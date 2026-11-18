import type { Metadata } from "next";
import { TrackView } from "@/components/TrackView";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { getTenantSession } from "@/lib/auth";
import { SignInForm } from "./SignInForm";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your Coderswurld Inventory account.",
  robots: { index: false, follow: false },
};

/**
 * The sign-in screen. Both `proxy.ts` and `requireTenant()` redirect here, and
 * the proxy round-trips the page the user was trying to reach in `?next=`.
 */
export default async function SignInPage({ searchParams }: PageProps<"/signin">) {
  // Already signed in? Don't show a login form — that reads as "your session
  // died" and sends people looking for a problem that isn't there.
  const session = await getTenantSession();
  const params = await searchParams;
  const rawNext = typeof params.next === "string" ? params.next : undefined;
  // Only ever accept a same-origin path. An open redirect on a login page is
  // how credential-phishing pages get a legitimate domain in the address bar.
  const next = rawNext?.startsWith("/") && !rawNext.startsWith("//") ? rawNext : undefined;

  if (session) {
    if (session.locked) redirect("/locked");
    redirect(next ?? (session.user.role === "CASHIER" ? "/pos" : "/dashboard"));
  }

  return (
    <>
    <TrackView />
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to open your shop, your till and your reports."
      footer={
        <div className="space-y-4">
          <p className="rounded-2xl bg-navy-50 px-4 py-3 text-sm leading-relaxed text-navy-900">
            <span className="font-semibold">Forgot your password?</span> Ask your main admin to
            reset it from <span className="font-semibold">Staff</span>. It takes seconds.
          </p>
          <p className="text-center text-sm text-ink-600">
            New to Coderswurld?{" "}
            <Link href="/#pricing" className="font-semibold text-navy-700 hover:underline">
              Choose a plan
            </Link>
          </p>
        </div>
      }
    >
      <SignInForm next={next} />
    </AuthShell>
    </>
  );
}
