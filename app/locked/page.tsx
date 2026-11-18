import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Clock, Mail, MessageCircle, Phone, ShieldAlert } from "lucide-react";

import { Logo } from "@/components/Logo";
import { SignOutButton } from "@/components/SignOutButton";
import { requireTenant } from "@/lib/auth";
import { formatNaira } from "@/lib/money";
import { getPlan } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Account locked",
  robots: { index: false, follow: false },
};

/**
 * Shown when an organization is PENDING, SUSPENDED or EXPIRED.
 *
 * This page is reachable with `allowLocked: true` on purpose. Locking a
 * customer out of the one screen that tells them how to pay you is a
 * self-inflicted wound — the whole point of this screen is to make renewing
 * frictionless, so it carries the renewal amount, the reference to quote, and
 * one-tap contact links.
 */
export default async function LockedPage() {
  const session = await requireTenant({ allowLocked: true });

  // Not locked? Then this page is just a dead end. Send them where they belong.
  if (!session.locked) {
    redirect(session.user.role === "CASHIER" ? "/pos" : "/dashboard");
  }

  const plan = getPlan(session.org.plan);
  const supportEmail = process.env.SUPPORT_EMAIL || "support@coderswurld.com";
  const supportPhone = process.env.SUPPORT_PHONE || "+2348000000000";
  const supportWhatsapp = (process.env.SUPPORT_WHATSAPP || supportPhone).replace(/\D/g, "");

  const subject = encodeURIComponent(`Renewal — ${session.org.name} (${session.org.slug})`);
  const whatsappText = encodeURIComponent(
    `Hello Coderswurld, I want to renew our ${plan.name} plan for ${session.org.name}.`,
  );

  const expired = session.org.status === "EXPIRED" || (session.expiresAt != null && session.expiresAt.getTime() < Date.now());

  return (
    <main className="flex min-h-dvh flex-col bg-canvas">
      <header className="border-b border-hairline bg-white">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Logo />
          <SignOutButton className="btn btn-ghost btn-sm" />
        </div>
      </header>

      <div className="mx-auto w-full max-w-lg flex-1 px-4 py-12">
        <div className="card card-pad text-center">
          <div
            className={`mx-auto mb-4 grid size-12 place-items-center rounded-full ${
              expired ? "bg-warn-50" : "bg-bad-50"
            }`}
          >
            {expired ? (
              <Clock className="size-6 text-warn-700" strokeWidth={2.25} />
            ) : (
              <ShieldAlert className="size-6 text-bad-700" strokeWidth={2.25} />
            )}
          </div>

          <h1 className="text-xl font-bold tracking-tight text-ink-950">
            {session.org.status === "PENDING"
              ? "Your account isn't active yet"
              : expired
                ? "Your subscription has expired"
                : "This account is suspended"}
          </h1>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-600">
            {session.lockReason}
          </p>

          <dl className="mt-6 divide-y divide-hairline rounded-xl border border-hairline text-left text-sm">
            <Row label="Business" value={session.org.name} />
            <Row label="Account code" value={session.org.slug} mono />
            <Row
              label="Plan"
              value={`${plan.name} — ${formatNaira(plan.priceKobo)}/year`}
            />
            {session.expiresAt ? (
              <Row
                label={expired ? "Expired on" : "Expires"}
                value={session.expiresAt.toLocaleDateString("en-NG", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              />
            ) : null}
          </dl>

          <p className="mt-6 text-sm font-semibold text-ink-900">
            {session.org.status === "PENDING"
              ? "Once your payment lands we activate you the same day."
              : "Make one transfer for the year and we'll switch you straight back on."}
          </p>

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <a
              href={`https://wa.me/${supportWhatsapp}?text=${whatsappText}`}
              target="_blank"
              rel="noreferrer"
              className="btn btn-primary"
            >
              <MessageCircle className="size-4" />
              WhatsApp us
            </a>
            <a href={`mailto:${supportEmail}?subject=${subject}`} className="btn btn-outline">
              <Mail className="size-4" />
              Email us
            </a>
          </div>

          <a
            href={`tel:${supportPhone}`}
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-ink-500 hover:text-ink-800"
          >
            <Phone className="size-3.5" />
            {supportPhone}
          </a>
        </div>

        <p className="mt-6 text-center text-xs leading-relaxed text-ink-500">
          Your data is safe and untouched. Nothing is deleted while an account is
          locked — everything is exactly where you left it when you come back.
        </p>
      </div>
    </main>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 px-3.5 py-2.5">
      <dt className="text-ink-500">{label}</dt>
      <dd className={`text-right font-semibold text-ink-900 ${mono ? "font-mono text-xs" : ""}`}>
        {value}
      </dd>
    </div>
  );
}
