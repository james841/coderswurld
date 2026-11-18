import Link from "next/link";

/**
 * Wordmark. Blue mark, "Coderswurld" in ink, orange "Inventory" — solid fills
 * only, no gradient anywhere in this product.
 */
export function Logo({
  href = "/",
  size = "md",
  inverted = false,
}: {
  href?: string | null;
  size?: "sm" | "md" | "lg";
  /** Use on dark backgrounds: white text instead of black. */
  inverted?: boolean;
}) {
  const text =
    size === "lg" ? "text-xl" : size === "sm" ? "text-[0.9375rem]" : "text-[1.0625rem]";
  const mark =
    size === "lg" ? "size-9 text-base" : size === "sm" ? "size-6 text-[0.6875rem]" : "size-7 text-xs";

  const inner = (
    <span className="inline-flex items-center gap-2">
      <span
        className={`${mark} grid place-items-center rounded-lg font-bold shrink-0 ${
          // On a blue background the blue mark would vanish: flip it to white.
          inverted ? "bg-white text-navy-700" : "bg-navy-700 text-white"
        }`}
        aria-hidden
      >
        CW
      </span>
      <span className={`${text} font-bold tracking-tight leading-none`}>
        <span className={inverted ? "text-white" : "text-ink-950"}>Coderswurld</span>
        <span className="text-brand-500"> Inventory</span>
      </span>
    </span>
  );

  if (!href) return inner;
  return (
    <Link href={href} className="inline-flex shrink-0" aria-label="Coderswurld Inventory — home">
      {inner}
    </Link>
  );
}
