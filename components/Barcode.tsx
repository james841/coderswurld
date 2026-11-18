import {
  BarcodeError,
  encodeBarcode,
  type Symbology,
} from "@/lib/barcode";

/**
 * A barcode, as SVG.
 *
 * No canvas, no image request, no client JavaScript — this is a pure function
 * of its props, so it renders on the server, inside a Server Component, in a
 * print sheet, and in the offline POS alike. An <img> would cost a request per
 * product; a canvas would need a client component and wouldn't print crisply.
 *
 * SVG also prints correctly at any DPI, which is the whole point: a thermal
 * printer at 203dpi and a laser printer at 600dpi both get sharp edges from the
 * same markup, and `shape-rendering: crispEdges` (set in globals.css) stops the
 * browser from anti-aliasing the bars into grey mush that a scanner can't read.
 */
export function Barcode({
  value,
  symbology,
  moduleWidth = 2,
  height = 56,
  showText = true,
  fontSize = 12,
  className,
}: {
  value: string;
  /** Force a symbology. Omit to detect it from the value. */
  symbology?: Symbology;
  /** Device pixels per narrow bar. Below 2 a 203dpi thermal printer struggles. */
  moduleWidth?: number;
  /** Bar height in pixels, excluding the human-readable text. */
  height?: number;
  showText?: boolean;
  fontSize?: number;
  className?: string;
}) {
  let encoded;
  try {
    encoded = encodeBarcode(value, symbology);
  } catch (error) {
    /*
     * A bad barcode must not take the page down with it. Products get imported
     * from spreadsheets typed by hand in a market, and one malformed cell in
     * row 400 should show up as a visible problem on that row — not a white
     * screen where the product list used to be.
     */
    return (
      <span
        className={`inline-flex items-center rounded-md bg-bad-50 px-2 py-1 text-xs font-semibold text-bad-700 ${className ?? ""}`}
        title={error instanceof BarcodeError ? error.message : "Unprintable barcode"}
      >
        Can&apos;t print this code
      </span>
    );
  }

  const { modules, tallBars, textGroups, quietZone } = encoded;
  const isEan = encoded.symbology !== "CODE128";

  // Guard bars drop below the others so the digits can sit in the gap between
  // them — the familiar EAN look, and it tells a cashier which way up it goes.
  const guardDrop = showText && isEan ? fontSize * 0.55 : 0;
  const textBand = showText ? fontSize + 3 : 0;

  const totalModules = modules.length + quietZone * 2;
  const width = totalModules * moduleWidth;
  const svgHeight = height + guardDrop + textBand;

  const tall = new Set(tallBars);

  /*
   * Runs of adjacent bars are merged into one rect, except where a guard bar
   * needs a different height. One rect per visual bar instead of one per module
   * cuts the markup by about 70% — which matters on a label sheet of 60
   * products, where the difference is a 40KB page and a 400KB one.
   */
  const rects: { x: number; w: number; tall: boolean }[] = [];
  let index = 0;
  while (index < modules.length) {
    if (modules[index] === "0") {
      index += 1;
      continue;
    }
    const isTall = tall.has(index);
    let run = 1;
    while (
      index + run < modules.length &&
      modules[index + run] === "1" &&
      tall.has(index + run) === isTall
    ) {
      run += 1;
    }
    rects.push({ x: (quietZone + index) * moduleWidth, w: run * moduleWidth, tall: isTall });
    index += run;
  }

  return (
    <svg
      className={`barcode-svg ${className ?? ""}`}
      width={width}
      height={svgHeight}
      viewBox={`0 0 ${width} ${svgHeight}`}
      role="img"
      aria-label={`Barcode ${encoded.text}`}
      shapeRendering="crispEdges"
    >
      {/* White ground: a barcode on a tinted card still needs its quiet zone. */}
      <rect x="0" y="0" width={width} height={svgHeight} fill="#fff" />

      {rects.map((bar, i) => (
        <rect
          key={i}
          x={bar.x}
          y={0}
          width={bar.w}
          height={bar.tall ? height + guardDrop : height}
          fill="#000"
        />
      ))}

      {showText
        ? textGroups.map((group, i) => {
            const start = (quietZone + group.startModule) * moduleWidth;
            const end = (quietZone + group.endModule) * moduleWidth;
            return (
              <text
                key={i}
                x={(start + end) / 2}
                y={svgHeight - 1}
                textAnchor="middle"
                fontFamily="ui-monospace, 'Courier New', monospace"
                fontSize={fontSize}
                letterSpacing={isEan ? fontSize * 0.14 : 0}
                fill="#000"
              >
                {group.value}
              </text>
            );
          })
        : null}
    </svg>
  );
}

/**
 * One shelf-edge label: name, price, barcode.
 *
 * Sized for a 38×25mm thermal label, the common roll size in Nigerian shops.
 * The price is the biggest thing on it because that is what a customer reads;
 * the barcode is sized for the scanner, not for looks.
 */
export function BarcodeLabel({
  name,
  code,
  price,
  sku,
}: {
  name: string;
  code: string;
  price?: string;
  sku?: string;
}) {
  return (
    <div className="flex w-[38mm] flex-col items-center justify-between overflow-hidden border border-ink-200 bg-white px-1 py-1 text-center">
      <p className="w-full truncate text-[7pt] font-semibold leading-tight text-black">{name}</p>
      {price ? <p className="text-[11pt] font-bold leading-none text-black">{price}</p> : null}
      <Barcode value={code} moduleWidth={1} height={28} fontSize={6} />
      {sku ? <p className="w-full truncate text-[5pt] leading-none text-black">{sku}</p> : null}
    </div>
  );
}
