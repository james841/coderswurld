"use client";

import { EASE, m } from "@/components/motion";

/**
 * The landing-page hero picture: a shop counter in front of stocked shelves,
 * drawn in the flat, wave-textured poster style of the brand.
 *
 * Drawn as SVG, not a photo, for three reasons: it weighs a few kilobytes
 * instead of a few hundred; it is crisp on every screen; and it can carry the
 * exact brand colours and the banknote wave texture, which a stock photo
 * cannot. Each layer rises into place on load (components/motion), and the
 * whole scene is decorative, so screen readers skip it.
 */

const NAVY_950 = "#0b1a3d";
const NAVY_900 = "#122a63";
const NAVY_700 = "#1d4ed8";
const NAVY_400 = "#6093fa";
const NAVY_200 = "#bfd5fe";
const ORANGE = "#f97316";
const ORANGE_DK = "#c2410c";
const ORANGE_LT = "#fdba74";
const RED = "#dc2626";
const RED_LT = "#fca5a5";
const WHITE = "#ffffff";
const CREAM = "#fff7ed";

function Rise({
  children,
  delay,
  y = 30,
}: {
  children: React.ReactNode;
  delay: number;
  y?: number;
}) {
  return (
    <m.g
      initial={{ opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, ease: EASE, delay }}
    >
      {children}
    </m.g>
  );
}

/** A row of goods on a shelf. Kinds are mixed so the shelf reads as a real shop. */
const GOOD_WIDTH: Record<string, number> = {
  "box-red": 34,
  "box-orange": 34,
  "box-white": 34,
  can: 22,
  bottle: 18,
  bag: 40,
};

function Goods({ x, y, items }: { x: number; y: number; items: string[] }) {
  // Where each item starts along the shelf, worked out before drawing.
  const starts = items.reduce<number[]>(
    (acc, kind, i) => [...acc, i === 0 ? x : acc[i - 1] + GOOD_WIDTH[items[i - 1]] + 7],
    [],
  );
  return (
    <g>
      {items.map((kind, i) => {
        const at = starts[i];
        let node: React.ReactNode = null;
        let w = 0;
        switch (kind) {
          case "box-red":
          case "box-orange":
          case "box-white": {
            w = 34;
            const fill = kind === "box-red" ? RED : kind === "box-orange" ? ORANGE : WHITE;
            node = (
              <g>
                <rect x={at} y={y - 46} width={w} height={46} rx={3} fill={fill} />
                <rect x={at + 6} y={y - 34} width={w - 12} height={12} rx={2} fill={kind === "box-white" ? NAVY_700 : WHITE} opacity={0.9} />
              </g>
            );
            break;
          }
          case "can": {
            w = 22;
            node = (
              <g>
                <rect x={at} y={y - 30} width={w} height={30} rx={4} fill={NAVY_200} />
                <rect x={at} y={y - 22} width={w} height={11} fill={RED} />
              </g>
            );
            break;
          }
          case "bottle": {
            w = 18;
            node = (
              <g>
                <rect x={at + 6} y={y - 52} width={6} height={10} rx={2} fill={WHITE} />
                <rect x={at} y={y - 44} width={w} height={44} rx={6} fill={NAVY_400} />
                <rect x={at} y={y - 30} width={w} height={12} fill={WHITE} opacity={0.85} />
              </g>
            );
            break;
          }
          case "bag": {
            w = 40;
            node = (
              <g>
                <path d={`M${at} ${y} L${at + 3} ${y - 38} L${at + w - 3} ${y - 38} L${at + w} ${y} Z`} fill={ORANGE_LT} />
                <rect x={at + 8} y={y - 28} width={w - 16} height={10} rx={2} fill={ORANGE_DK} />
              </g>
            );
            break;
          }
        }
        return <g key={`${kind}-${i}`}>{node}</g>;
      })}
    </g>
  );
}

export function ShopScene({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 640 520"
      className={className}
      aria-hidden
      focusable="false"
      preserveAspectRatio="xMidYMax meet"
      style={{ display: "block" }}
    >
      <defs>
        {/* The banknote wave, as an SVG pattern so it can sit inside shapes. */}
        <pattern id="sw-light" width="48" height="10" patternUnits="userSpaceOnUse">
          <path d="M0 5 Q6 1 12 5 T24 5 T36 5 T48 5" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="1.2" />
        </pattern>
        <pattern id="sw-dark" width="48" height="10" patternUnits="userSpaceOnUse">
          <path d="M0 5 Q6 1 12 5 T24 5 T36 5 T48 5" fill="none" stroke="rgba(11,26,61,0.18)" strokeWidth="1.2" />
        </pattern>
        <clipPath id="sw-sun">
          <circle cx="330" cy="330" r="250" />
        </clipPath>
      </defs>

      {/* Sun */}
      <Rise delay={0.15} y={60}>
        <circle cx="330" cy="330" r="250" fill={ORANGE} />
        <rect x="0" y="0" width="640" height="520" fill="url(#sw-dark)" clipPath="url(#sw-sun)" />
      </Rise>

      {/* Shelving */}
      <Rise delay={0.3}>
        <rect x="120" y="120" width="420" height="300" rx="10" fill={NAVY_900} />
        <rect x="120" y="120" width="420" height="300" rx="10" fill="url(#sw-light)" />
        <rect x="120" y="108" width="420" height="22" rx="6" fill={NAVY_950} />
        {[200, 280, 360].map((y) => (
          <rect key={y} x="132" y={y} width="396" height="8" rx="2" fill={NAVY_950} />
        ))}
        <Goods x={142} y={200} items={["box-red", "box-orange", "can", "can", "box-white", "bottle", "bottle", "box-red", "can", "box-orange"]} />
        <Goods x={142} y={280} items={["bag", "bag", "box-white", "can", "can", "can", "bottle", "box-orange", "box-red"]} />
        <Goods x={142} y={360} items={["bottle", "bottle", "bottle", "box-orange", "box-white", "bag", "can", "can", "box-red"]} />
      </Rise>

      {/* "OPEN" sign */}
      <m.g
        initial={{ opacity: 0, rotate: -12 }}
        animate={{ opacity: 1, rotate: 0 }}
        transition={{ duration: 0.9, ease: EASE, delay: 0.9 }}
        style={{ originX: "86px", originY: "70px" }}
      >
        <line x1="86" y1="70" x2="64" y2="104" stroke={NAVY_950} strokeWidth="2" />
        <line x1="86" y1="70" x2="108" y2="104" stroke={NAVY_950} strokeWidth="2" />
        <rect x="46" y="102" width="80" height="34" rx="6" fill={RED} />
        <text x="86" y="125" textAnchor="middle" fontSize="16" fontWeight="800" fill={WHITE} fontFamily="inherit" letterSpacing="2">
          OPEN
        </text>
      </m.g>

      {/* Counter */}
      <Rise delay={0.45} y={40}>
        {/* Dark navy, the colour of the strip below the hero, so the counter
            reads as resting on it. */}
        <rect x="0" y="396" width="640" height="124" fill={NAVY_950} />
        <rect x="0" y="396" width="640" height="124" fill="url(#sw-light)" />
        <rect x="24" y="386" width="592" height="18" rx="6" fill={NAVY_400} />
      </Rise>

      {/* Till */}
      <Rise delay={0.65} y={24}>
        <rect x="372" y="300" width="18" height="90" rx="4" fill={NAVY_950} />
        <rect x="318" y="234" width="170" height="104" rx="12" fill={NAVY_950} />
        <rect x="328" y="244" width="150" height="84" rx="7" fill={WHITE} />
        <text x="340" y="268" fontSize="11" fontWeight="700" fill={NAVY_400} fontFamily="inherit">
          TOTAL
        </text>
        <text x="340" y="298" fontSize="28" fontWeight="800" fill={NAVY_950} fontFamily="inherit">
          ₦9,400
        </text>
        <rect x="340" y="308" width="56" height="12" rx="6" fill={RED} />
        <rect x="402" y="308" width="64" height="12" rx="6" fill={NAVY_200} />
      </Rise>

      {/* Receipt curling from the printer */}
      <Rise delay={0.85} y={-16}>
        <rect x="500" y="356" width="64" height="34" rx="6" fill={NAVY_950} />
        <path d="M510 360 L554 360 L554 300 Q554 290 546 292 L518 296 Q510 298 510 306 Z" fill={CREAM} />
        {[310, 320, 330, 340].map((y, i) => (
          <rect key={y} x="518" y={y} width={i === 3 ? 18 : 28} height="4" rx="2" fill={NAVY_200} />
        ))}
      </Rise>

      {/* Basket */}
      <Rise delay={0.75} y={24}>
        <rect x="104" y="352" width="34" height="34" rx="4" fill={ORANGE} />
        <rect x="142" y="340" width="20" height="46" rx="6" fill={NAVY_400} />
        <rect x="166" y="358" width="30" height="28" rx="4" fill={RED} />
        <path d="M84 372 L224 372 L210 396 L98 396 Z" fill={RED} />
        <path d="M84 372 L224 372 L210 396 L98 396 Z" fill="url(#sw-light)" />
        <path d="M110 372 Q154 320 198 372" fill="none" stroke={RED_LT} strokeWidth="5" />
      </Rise>

      {/* Coins: a nod to the money side of the day */}
      <m.g
        initial={{ opacity: 0, y: -30 }}
        animate={{ opacity: 1, y: [0, -6, 0] }}
        transition={{
          opacity: { duration: 0.6, delay: 1.1 },
          y: { duration: 4.5, repeat: Infinity, ease: "easeInOut", delay: 1.1 },
        }}
      >
        <ellipse cx="584" cy="170" rx="26" ry="9" fill={ORANGE_DK} />
        <rect x="558" y="156" width="52" height="14" fill={ORANGE_DK} />
        <ellipse cx="584" cy="156" rx="26" ry="9" fill={ORANGE_LT} />
        <ellipse cx="596" cy="126" rx="22" ry="22" fill={WHITE} />
        <ellipse cx="596" cy="126" rx="15" ry="15" fill="none" stroke={NAVY_700} strokeWidth="3" />
        <text x="596" y="132" textAnchor="middle" fontSize="16" fontWeight="800" fill={NAVY_700} fontFamily="inherit">
          ₦
        </text>
      </m.g>
    </svg>
  );
}
