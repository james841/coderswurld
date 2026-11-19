import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";

/**
 * Wordmark: the scan mark, "Coderswurld" in ink, orange "Inventory".
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
  const markSize = size === "lg" ? 36 : size === "sm" ? 24 : 28;

  const inner = (
    <span className="inline-flex items-center gap-2">
      <BrandMark size={markSize} simple={size === "sm"} ring={inverted} />
      <span className={`${text} font-bold tracking-tight leading-none`}>
        <span className={inverted ? "text-white" : "text-ink-950"}>Coderswurld</span>
        <span className="text-brand-500"> Inventory</span>
      </span>
    </span>
  );

  if (!href) return inner;
  return (
    <Link href={href} className="inline-flex shrink-0" aria-label="Coderswurld Inventory home">
      {inner}
    </Link>
  );
}
