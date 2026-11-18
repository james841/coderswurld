import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, KeyRound } from "lucide-react";

import { Logo } from "@/components/Logo";
import { SignOutButton } from "@/components/SignOutButton";
import { requireTenant } from "@/lib/auth";
import { ChangePasswordForm } from "./ChangePasswordForm";

export const metadata: Metadata = {
  title: "Change password",
  robots: { index: false, follow: false },
};

/**
 * The password gate.
 *
 * This route sits OUTSIDE the `(app)` group on purpose. That group's layout
 * redirects anyone carrying `mustChangePassword` here — if this page lived
 * inside it, arriving would trigger the redirect that brought you, forever.
 *
 * It serves two jobs with the same form, because they are the same job: a
 * forced change after a provisioning or reset temp password, and a voluntary
 * change from the account menu. The only difference is the copy and whether
 * there's a way out, so the difference stays copy rather than a second route.
 */
export default async function ChangePasswordPage() {
  const session = await requireTenant();
  const forced = session.user.mustChangePassword;
  const home = session.user.role === "CASHIER" ? "/pos" : "/dashboard";

  return (
    <main className="flex min-h-dvh flex-col bg-canvas">
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-7 text-center">
            <Logo size="lg" href={forced ? null : home} />
            <div className="mx-auto mt-6 grid size-11 place-items-center rounded-full bg-brand-50">
              <KeyRound className="size-5 text-brand-700" />
            </div>
            <h1 className="mt-3 text-2xl font-bold tracking-tight text-ink-950">
              {forced ? "Set your password" : "Change your password"}
            </h1>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-600">
              {forced ? (
                <>
                  You&apos;re signed in with a temporary password. Choose your own
                  before you carry on. The one you were given works until you do,
                  and anyone who has seen it can use it.
                </>
              ) : (
                <>Pick something only you know. You&apos;ll stay signed in.</>
              )}
            </p>
          </div>

          <div className="card card-pad">
            <ChangePasswordForm redirectTo={home} forced={forced} />
          </div>

          {forced ? (
            <>
              <p className="mt-5 text-center text-xs leading-relaxed text-ink-500">
                Signed in as{" "}
                <span className="font-semibold text-ink-700">{session.user.email ?? session.user.name}</span>
                {session.org.name ? ` · ${session.org.name}` : ""}
              </p>
              {/* The only way out of the gate, for someone sitting at the wrong
                  account — not an escape from setting a password. */}
              <div className="mt-3 text-center">
                <SignOutButton
                  className="text-xs font-semibold text-ink-500 hover:text-ink-800"
                  label="This isn't my account — sign out"
                  showIcon={false}
                />
              </div>
            </>
          ) : (
            <div className="mt-5 text-center">
              <Link
                href={home}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-500 hover:text-ink-800"
              >
                <ArrowLeft className="size-3.5" />
                Back without changing anything
              </Link>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
