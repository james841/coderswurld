import Link from "next/link";
import { ArrowLeft, Check } from "lucide-react";

import { Logo } from "@/components/Logo";
import { Reveal, Stagger, StaggerItem } from "@/components/motion";

/**
 * The two-sided layout for every sign-in screen.
 *
 * Left: the form, on white, with nothing else competing for attention.
 * Right (tablet and up): a dark blue, wave-textured panel with one product
 * card in it, a reminder of what the person is signing in to. It is
 * decoration, so it is hidden on phones, where the form needs the whole
 * screen, and from screen readers.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
  panel = "shop",
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  panel?: "shop" | "platform";
}) {
  return (
    <main className="grid min-h-dvh bg-white lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <div className="flex items-center justify-between">
          <Logo />
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-500 hover:text-ink-900"
          >
            <ArrowLeft className="size-3.5" />
            Home
          </Link>
        </div>

        <Reveal className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10">
          <h1 className="text-3xl font-bold tracking-tight text-ink-950 sm:text-4xl">{title}</h1>
          <p className="mt-2 text-base text-ink-600">{subtitle}</p>
          <div className="mt-8">{children}</div>
          {footer ? <div className="mt-8">{footer}</div> : null}
        </Reveal>
      </div>

      <AuthPanel variant={panel} />
    </main>
  );
}

function AuthPanel({ variant }: { variant: "shop" | "platform" }) {
  const shop = variant === "shop";
  const items = shop
    ? [
        { label: "Count the cash drawer", done: true },
        { label: "Check each cashier's sales", done: true },
        { label: "Reorder what's running low", done: true },
        { label: "Daily report sent to WhatsApp", done: true },
        { label: "Lock up and go home", done: false },
      ]
    : [
        { label: "New plan requests", done: true },
        { label: "Payments confirmed", done: true },
        { label: "Shops activated", done: true },
        { label: "Renewals due this month", done: false },
      ];

  return (
    <aside
      aria-hidden
      className="texture-waves relative hidden overflow-hidden bg-navy-950 p-10 text-white lg:flex lg:flex-col lg:justify-between xl:p-14"
    >
      {/* An orange sun rising behind the card: the brand poster motif. */}
      <div className="pointer-events-none absolute -right-24 top-24 size-[26rem] rounded-full bg-brand-500/90" />
      <div className="texture-waves pointer-events-none absolute -right-24 top-24 size-[26rem] rounded-full" />

      <div className="relative mt-6 max-w-md self-end rounded-3xl bg-white p-7 text-ink-950 shadow-[0_30px_80px_-20px_rgb(0_0_0/0.6)] xl:p-8">
        <p className="text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-ink-500">
          {shop ? "Closing time · checklist" : "Platform · today"}
        </p>
        <p className="mt-2 text-3xl font-bold tracking-tight">{shop ? "Ready to close?" : "Morning round"}</p>
        <Stagger className="mt-5 divide-y divide-hairline" gap={0.12} delay={0.4}>
          {items.map((item) => (
            <StaggerItem key={item.label} className="flex items-center gap-3 py-3.5">
              <span
                className={`grid size-7 shrink-0 place-items-center rounded-lg ${
                  item.done ? "bg-navy-700 text-white" : "border-2 border-ink-200"
                }`}
              >
                {item.done ? <Check className="size-4" strokeWidth={3} /> : null}
              </span>
              <span className={`text-base font-semibold ${item.done ? "text-ink-900" : "text-ink-500"}`}>
                {item.label}
              </span>
            </StaggerItem>
          ))}
        </Stagger>
      </div>

      <div className="relative max-w-lg">
        <p className="text-3xl font-bold leading-tight tracking-tight xl:text-4xl">
          {shop ? (
            <>
              One login for your till, your stock and{" "}
              <span className="text-brand-400">every naira</span> in between.
            </>
          ) : (
            <>Every shop on Coderswurld, in one place.</>
          )}
        </p>
        <p className="mt-3 text-base text-navy-200">
          {shop
            ? "Owners, managers, storekeepers and cashiers all sign in here."
            : "For the Coderswurld team only."}
        </p>
      </div>
    </aside>
  );
}
