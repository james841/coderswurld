"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence } from "motion/react";
import { ArrowRight, ArrowUp, Menu, X } from "lucide-react";

import { Logo } from "@/components/Logo";
import { EASE, m } from "@/components/motion";

/**
 * The landing-page navigation.
 *
 * At the top of the page it is see-through, white text over the blue hero, so
 * the hero reads as one block. Once you scroll it becomes a floating white pill
 * with a soft shadow, and the link for the section you are reading is
 * highlighted. On a phone the links fold into a menu button.
 */

const LINKS = [
  { href: "#features", id: "features", label: "Features" },
  { href: "#departments", id: "departments", label: "Supermarket & pharmacy" },
  { href: "#pricing", id: "pricing", label: "Pricing" },
  { href: "#faq", id: "faq", label: "FAQ" },
];

function useScrolled(threshold: number) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold]);
  return scrolled;
}

/** Which section is on screen, for the highlighted link. */
function useActiveSection(ids: string[]) {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id);
        }
      },
      // A section counts as "being read" when it crosses the upper middle of the screen.
      { rootMargin: "-40% 0px -55% 0px" },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [ids]);
  return active;
}

const IDS = LINKS.map((l) => l.id);

export function LandingNav() {
  const scrolled = useScrolled(24);
  const active = useActiveSection(IDS);
  const [open, setOpen] = useState(false);
  const solid = scrolled || open;

  return (
    <header className="fixed inset-x-0 top-0 z-50 px-3 pt-3">
      <nav
        className={`mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 rounded-full pl-4 pr-2 transition-all duration-300 ${
          solid
            ? "bg-white/95 shadow-[0_10px_30px_-12px_rgb(11_26_61/0.35)] ring-1 ring-ink-950/5 backdrop-blur"
            : "bg-transparent"
        }`}
        aria-label="Main"
      >
        <Logo inverted={!solid} />

        <ul className="hidden items-center gap-1 lg:flex">
          {LINKS.map((link) => {
            const on = active === link.id;
            return (
              <li key={link.id}>
                <a
                  href={link.href}
                  className={`rounded-full px-3.5 py-2 text-sm font-semibold transition-colors ${
                    solid
                      ? on
                        ? "bg-navy-50 text-navy-800"
                        : "text-ink-700 hover:bg-ink-50 hover:text-ink-950"
                      : on
                        ? "bg-white/15 text-white"
                        : "text-white/85 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  {link.label}
                </a>
              </li>
            );
          })}
        </ul>

        <div className="flex items-center gap-1.5">
          <Link
            href="/signin"
            className={`hidden rounded-full px-4 py-2 text-sm font-semibold transition-colors sm:inline-flex ${
              solid ? "text-ink-800 hover:bg-ink-50" : "text-white hover:bg-white/10"
            }`}
          >
            Sign in
          </Link>
          {/* Hidden on phones: logo + button + menu don't fit 390px, and the menu
              and the hero's own button cover it. */}
          <a href="#pricing" className="btn btn-primary btn-sm hidden h-10 rounded-full px-4 sm:inline-flex">
            Get started
            <ArrowRight className="size-4" />
          </a>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? "Close menu" : "Open menu"}
            className={`grid size-10 place-items-center rounded-full transition-colors lg:hidden ${
              solid ? "text-ink-800 hover:bg-ink-50" : "text-white hover:bg-white/10"
            }`}
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </nav>

      <AnimatePresence>
        {open ? (
          <m.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.2, ease: EASE }}
            className="mx-auto mt-2 max-w-6xl overflow-hidden rounded-3xl bg-white p-2 shadow-[0_20px_50px_-15px_rgb(11_26_61/0.4)] ring-1 ring-ink-950/5 lg:hidden"
          >
            {LINKS.map((link) => (
              <a
                key={link.id}
                href={link.href}
                onClick={() => setOpen(false)}
                className="block rounded-2xl px-4 py-3 text-base font-semibold text-ink-900 hover:bg-navy-50"
              >
                {link.label}
              </a>
            ))}
            <div className="mt-1 grid grid-cols-2 gap-2">
              <Link
                href="/signin"
                className="rounded-2xl bg-canvas px-4 py-3 text-center text-base font-semibold text-navy-800"
              >
                Sign in
              </Link>
              <a
                href="#pricing"
                onClick={() => setOpen(false)}
                className="rounded-2xl bg-brand-700 px-4 py-3 text-center text-base font-semibold text-white"
              >
                Get started
              </a>
            </div>
          </m.div>
        ) : null}
      </AnimatePresence>
    </header>
  );
}

/** The round "back to top" button, bottom right, once you have scrolled a screen or so. */
export function ScrollToTop() {
  const show = useScrolled(700);
  return (
    <AnimatePresence>
      {show ? (
        <m.button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          aria-label="Back to top"
          initial={{ opacity: 0, scale: 0.6, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.6, y: 12 }}
          whileHover={{ y: -3 }}
          whileTap={{ scale: 0.92 }}
          transition={{ duration: 0.25, ease: EASE }}
          className="texture-waves fixed bottom-5 right-5 z-40 grid size-12 place-items-center rounded-full bg-navy-700 text-white shadow-[0_12px_30px_-8px_rgb(29_78_216/0.7)] ring-4 ring-white sm:bottom-7 sm:right-7"
        >
          <ArrowUp className="size-5" strokeWidth={2.5} />
        </m.button>
      ) : null}
    </AnimatePresence>
  );
}
