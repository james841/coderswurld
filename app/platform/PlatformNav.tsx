"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { BarChart3, Building2, Inbox, LayoutGrid, Loader2, LogOut, Mail, Receipt, ShieldCheck } from "lucide-react";

import { Logo } from "@/components/Logo";

/**
 * Platform console navigation.
 *
 * A dark blue, wave-textured sidebar on a desktop (the same family as the
 * shop's admin side, so the product feels like one thing), and a compact top
 * bar with scrolling links on a phone. Deliberately darker than the shop side:
 * this console touches every customer, and it should never be mistaken for a
 * shop's own back office.
 */

/** Live counts shown as badges beside the links. */
export interface NavCounts {
  requests: number;
  renewals: number;
  failedEmails: number;
}

type Badge = { n: number; tone: "brand" | "warn" | "bad" };

const SECTIONS: {
  title: string;
  links: { href: string; label: string; icon: typeof LayoutGrid; exact?: boolean; badge?: (c: NavCounts) => Badge }[];
}[] = [
  {
    title: "Home",
    links: [
      { href: "/platform", label: "Overview", icon: LayoutGrid, exact: true },
      { href: "/platform/traffic", label: "Site traffic", icon: BarChart3 },
    ],
  },
  {
    title: "Sales",
    links: [
      { href: "/platform/leads", label: "Plan requests", icon: Inbox, badge: (c) => ({ n: c.requests, tone: "brand" }) },
      { href: "/platform/organizations", label: "Businesses", icon: Building2 },
      { href: "/platform/subscriptions", label: "Subscriptions", icon: Receipt, badge: (c) => ({ n: c.renewals, tone: "warn" }) },
    ],
  },
  {
    title: "System",
    links: [{ href: "/platform/email", label: "Email", icon: Mail, badge: (c) => ({ n: c.failedEmails, tone: "bad" }) }],
  },
];
const LINKS = SECTIONS.flatMap((s) => s.links);

const BADGE_TONES = {
  brand: "bg-brand-500 text-white",
  warn: "bg-warn-500 text-ink-950",
  bad: "bg-bad-700 text-white",
} as const;

function NavBadge({ badge, active }: { badge?: Badge; active: boolean }) {
  if (!badge || badge.n <= 0) return null;
  return (
    <span
      className={`ml-auto min-w-5 rounded-full px-1.5 text-center text-[11px] font-bold leading-5 ${
        active ? "bg-navy-900 text-white" : BADGE_TONES[badge.tone]
      }`}
    >
      {badge.n > 99 ? "99+" : badge.n}
    </span>
  );
}

function useSignOut() {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await fetch("/api/platform/auth/signout", { method: "POST" });
    } catch {
      // Leave anyway.
    }
    router.replace("/platform/signin");
    router.refresh();
  }
  return { signOut, signingOut };
}

function isActive(pathname: string, href: string, exact?: boolean) {
  return exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");
}

export function PlatformNav({ operatorName, counts }: { operatorName: string; counts: NavCounts }) {
  const pathname = usePathname();
  const { signOut, signingOut } = useSignOut();

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="texture-waves fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-navy-950 text-white lg:flex">
        <div className="flex h-16 items-center px-5">
          <Link href="/platform">
            <Logo href={null} size="sm" inverted />
          </Link>
        </div>
        <div className="mx-4 mb-4 flex items-center gap-2 rounded-xl bg-white/8 px-3 py-2 ring-1 ring-white/10">
          <ShieldCheck className="size-4 text-brand-400" />
          <span className="text-xs font-bold uppercase tracking-wider text-white/80">Platform console</span>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3">
          {SECTIONS.map((section) => (
            <div key={section.title}>
              <p className="mb-1.5 px-3 text-[11px] font-bold uppercase tracking-[0.12em] text-white/40">{section.title}</p>
              <div className="space-y-0.5">
                {section.links.map(({ href, label, icon: Icon, exact, badge }) => {
                  const active = isActive(pathname, href, exact);
                  return (
                    <Link
                      key={href}
                      href={href}
                      aria-current={active ? "page" : undefined}
                      className={`relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${
                        active ? "bg-white text-navy-900 shadow-sm" : "text-white/70 hover:bg-white/8 hover:text-white"
                      }`}
                    >
                      {active ? <span className="absolute -left-3 top-2 h-7 w-1 rounded-r-full bg-brand-500" /> : null}
                      <Icon className="size-[1.125rem]" />
                      {label}
                      <NavBadge badge={badge?.(counts)} active={active} />
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="m-3 rounded-2xl bg-white/8 p-3 ring-1 ring-white/10">
          <div className="flex items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-500 text-sm font-bold text-ink-950">
              {operatorName.charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{operatorName}</p>
              <p className="text-xs text-white/55">Operator</p>
            </div>
            <button
              type="button"
              onClick={signOut}
              disabled={signingOut}
              title="Sign out"
              className="grid size-9 place-items-center rounded-lg text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            >
              {signingOut ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
              <span className="sr-only">Sign out</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Phone / tablet top bar */}
      <header className="texture-waves sticky top-0 z-30 bg-navy-950 text-white lg:hidden">
        <div className="flex h-14 items-center justify-between px-4">
          <Logo href={null} size="sm" inverted />
          <button
            type="button"
            onClick={signOut}
            disabled={signingOut}
            className="grid size-9 place-items-center rounded-lg text-white/75 hover:bg-white/10"
            aria-label="Sign out"
          >
            {signingOut ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
          </button>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 [scrollbar-width:none]">
          {LINKS.map(({ href, label, icon: Icon, exact, badge }) => {
            const active = isActive(pathname, href, exact);
            return (
              <Link
                key={href}
                href={href}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold ${
                  active ? "bg-white text-navy-900" : "text-white/75 hover:bg-white/10"
                }`}
              >
                <Icon className="size-4" />
                {label}
                <NavBadge badge={badge?.(counts)} active={active} />
              </Link>
            );
          })}
        </nav>
      </header>
    </>
  );
}
