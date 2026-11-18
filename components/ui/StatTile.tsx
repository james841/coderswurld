import Link from "next/link";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Minus } from "lucide-react";

import { CountUp } from "@/components/motion";

/**
 * One number, with whatever it takes to make it mean something.
 *
 * The `delta` is the point of this component. "₦482,000 today" is a fact;
 * "₦482,000 today, up 14% on yesterday" is information. A shop owner glancing
 * at a phone between customers reads the arrow, not the figure.
 *
 * Orange is reserved for the numeral and the icon — never a filled background
 * behind white text, which is where #F97316 stops being readable. Good/bad
 * tones are carried by the delta chip alone, so a screen of tiles stays
 * black-and-white until something actually needs attention.
 */
export function StatTile({
  icon: Icon,
  label,
  value,
  note,
  delta,
  href,
  tone = "plain",
  accent = false,
  count,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  note?: string;
  /** Percent change against the comparison period. Null when there's nothing to compare. */
  delta?: number | null;
  /** Makes the whole tile a link — use it when there's a list behind the number. */
  href?: string;
  tone?: "plain" | "warn" | "bad" | "good";
  /** Renders the figure in brand orange. For the one number that matters most. */
  accent?: boolean;
  /**
   * Give the raw figure as well and it counts up to `value` the first time the
   * tile is seen. `naira` figures are in kobo, like all money in this codebase.
   */
  count?: { value: number; kind: "number" | "naira" };
}) {
  const toneClass =
    tone === "warn"
      ? "border-warn-200 bg-warn-50"
      : tone === "bad"
        ? "border-bad-200 bg-bad-50"
        : tone === "good"
          ? "border-good-200 bg-good-50"
          : "";

  const iconClass =
    tone === "warn"
      ? "text-warn-700"
      : tone === "bad"
        ? "text-bad-700"
        : tone === "good"
          ? "text-good-700"
          : "text-ink-400";

  const body = (
    <>
      <div className="flex items-center gap-2">
        <Icon className={`size-4 shrink-0 ${iconClass}`} />
        <p className="truncate text-xs font-semibold uppercase tracking-wide text-ink-500">
          {label}
        </p>
        {href ? (
          <ArrowRight className="ml-auto size-3.5 shrink-0 text-ink-300 transition-transform group-hover:translate-x-0.5 group-hover:text-navy-700" />
        ) : null}
      </div>

      <p
        className={`tabular mt-1.5 text-2xl font-bold tracking-tight ${
          accent ? "text-brand-700" : "text-ink-950"
        }`}
      >
        {count ? <CountUp value={count.value} kind={count.kind} /> : value}
      </p>

      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
        {note ? <p className="text-xs text-ink-500">{note}</p> : null}
        {delta === undefined ? null : <Delta value={delta} />}
      </div>
    </>
  );

  if (href) {
    return (
      <Link href={href} className={`card card-pad group block transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-navy-200 hover:shadow-[var(--shadow-raised)] motion-reduce:transform-none ${toneClass}`}>
        {body}
      </Link>
    );
  }

  return <div className={`card card-pad ${toneClass}`}>{body}</div>;
}

function Delta({ value }: { value: number | null }) {
  if (value === null) {
    return <span className="text-xs text-ink-400">no figure to compare</span>;
  }

  // Rounded to whole percent: "up 13.8%" invites a precision this number does
  // not have, and nobody makes a decision on the decimal.
  const rounded = Math.round(value);

  if (rounded === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-ink-500">
        <Minus className="size-3" />
        level
      </span>
    );
  }

  const up = rounded > 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-bold ${
        up ? "text-good-700" : "text-bad-700"
      }`}
    >
      {up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
      {Math.abs(rounded)}%
    </span>
  );
}

/**
 * Percent change, with the one case that matters: yesterday was zero.
 *
 * "Up ∞%" or "up 100%" on the first day of trading is noise. Returning null
 * makes the tile say "no figure to compare", which is the truth.
 */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}
