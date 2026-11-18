import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/AuthShell";
import { getPlatformSession } from "@/lib/auth";
import { PlatformSignInForm } from "./PlatformSignInForm";

export const metadata: Metadata = {
  title: "Platform console",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * The operator's own sign-in. Dark, deliberately unlike the tenant app — when
 * you are supporting a customer with both consoles open, the background colour
 * should tell you at a glance whose data you are about to change.
 */
export default async function PlatformSignInPage({
  searchParams,
}: PageProps<"/platform/signin">) {
  const session = await getPlatformSession();
  const params = await searchParams;
  const rawNext = typeof params.next === "string" ? params.next : undefined;
  const next =
    rawNext?.startsWith("/platform") && !rawNext.startsWith("//") ? rawNext : undefined;

  if (session) redirect(next ?? "/platform");

  return (
    <AuthShell
      title="Platform console"
      subtitle="Coderswurld team sign-in. Sessions last 8 hours."
      panel="platform"
      footer={
        <p className="text-xs leading-relaxed text-ink-500">
          This console grants and revokes access to every customer account. Shop owners and
          staff sign in at{" "}
          <a href="/signin" className="font-semibold text-navy-700 hover:underline">
            the shop sign-in
          </a>
          .
        </p>
      }
    >
      <PlatformSignInForm next={next} />
    </AuthShell>
  );
}
