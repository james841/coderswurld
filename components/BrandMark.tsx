/**
 * The Coderswurld mark: a "C" inside barcode-scanner corners, crossed by an
 * orange scan line. `simple` drops the corners, for very small sizes (24px and
 * under) where they would turn into noise.
 */
export function BrandMark({
  size = 28,
  simple = false,
  ring = false,
  className = "",
}: {
  size?: number;
  simple?: boolean;
  /** Thin light outline, so the dark tile still reads on a dark background. */
  ring?: boolean;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={`shrink-0 ${className}`}
      aria-hidden
      focusable="false"
    >
      <rect width="64" height="64" rx="15" fill="#172554" />
      {ring && (
        <rect x="1" y="1" width="62" height="62" rx="14" fill="none" stroke="#fff" strokeOpacity=".22" strokeWidth="2" />
      )}
      {!simple && (
        <path
          d="M11 19v-5a3 3 0 0 1 3-3h5M45 11h5a3 3 0 0 1 3 3v5M53 45v5a3 3 0 0 1-3 3h-5M19 53h-5a3 3 0 0 1-3-3v-5"
          stroke="#fff"
          strokeOpacity=".5"
          strokeWidth="2.6"
          strokeLinecap="round"
          fill="none"
        />
      )}
      <path
        d={simple ? "M43.3 21.7A15 15 0 1 0 43.3 42.3" : "M41.9 23.6A13 13 0 1 0 41.9 40.4"}
        stroke="#fff"
        strokeWidth={simple ? 8.5 : 7}
        strokeLinecap="round"
        fill="none"
      />
      <path d={simple ? "M28 32h26" : "M29 32h23"} stroke="#f97316" strokeWidth={simple ? 4.6 : 3.6} strokeLinecap="round" />
    </svg>
  );
}
