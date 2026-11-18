/**
 * Barcode encoding — EAN-13, EAN-8, UPC-A and Code 128.
 *
 * WHY THIS IS HAND-WRITTEN AND NOT A DEPENDENCY
 * ---------------------------------------------
 * The encoders are a lookup table and a checksum. The libraries that wrap them
 * ship a canvas renderer, a font loader and a browser global, and this code has
 * to run in three places that each want something different: a server route
 * producing an SVG sheet of labels, a React component in the admin panel, and
 * the POS running offline from a service worker. A pure function returning a
 * module string works in all three and costs nothing to send.
 *
 * Correctness matters more than elegance here — a barcode that scans as the
 * wrong product is worse than no barcode. The check digits are computed, never
 * trusted from input, and `encodeBarcode` throws rather than silently emitting
 * something a scanner will read as a different number.
 *
 * WHAT A "MODULE STRING" IS
 * -------------------------
 * The output is a string of "1" (bar) and "0" (space), one character per module
 * — the narrowest printable unit. The renderer decides how many device pixels a
 * module gets; at 2px per module an EAN-13 is 190px wide, which is what a
 * cheap thermal printer resolves cleanly.
 */

export type Symbology = "EAN13" | "EAN8" | "UPCA" | "CODE128";

export interface EncodedBarcode {
  /** "1" = bar, "0" = space. One character per module. */
  modules: string;
  symbology: Symbology;
  /** The full value including any check digit this function added. */
  text: string;
  /**
   * Module indices where the bar runs 5 modules taller than the rest — the
   * guard patterns of an EAN/UPC symbol. Empty for Code 128, which has none.
   */
  tallBars: number[];
  /**
   * How the human-readable digits sit under the bars, for EAN/UPC where the
   * leading digit sits outside the symbol and the rest straddle the guards.
   */
  textGroups: { value: string; startModule: number; endModule: number }[];
  /** Quiet zone in modules. Scanners need it; printers crop without it. */
  quietZone: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// EAN / UPC
// ─────────────────────────────────────────────────────────────────────────────

const EAN_L = [
  "0001101", "0011001", "0010011", "0111101", "0100011",
  "0110001", "0101111", "0111011", "0110111", "0001011",
];

const EAN_G = [
  "0100111", "0110011", "0011011", "0100001", "0011101",
  "0111001", "0000101", "0010001", "0001001", "0010111",
];

const EAN_R = [
  "1110010", "1100110", "1101100", "1000010", "1011100",
  "1001110", "1010000", "1000100", "1001000", "1110100",
];

/**
 * Which of the first six digits use even parity, selected by the 13th (leading)
 * digit. This is the trick that lets 13 digits fit in a 12-digit symbol: the
 * leading digit isn't drawn at all, it's encoded in the parity pattern.
 */
const EAN13_PARITY = [
  "LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG",
  "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL",
];

/** EAN-8 has no leading digit, so its first four are always odd parity. */
const GUARD_EDGE = "101";
const GUARD_CENTRE = "01010";

/**
 * Check digit for a 12- or 7-digit EAN body (also UPC-A's 11).
 *
 * Weights alternate 1 and 3 from the RIGHT, which is why this walks the string
 * backwards instead of using the position in the string. Getting that backwards
 * produces a digit that's right half the time — the worst kind of bug, because
 * it passes a casual test.
 */
export function eanCheckDigit(body: string): number {
  let sum = 0;
  for (let i = body.length - 1, weight = 3; i >= 0; i -= 1, weight = weight === 3 ? 1 : 3) {
    sum += Number(body[i]) * weight;
  }
  return (10 - (sum % 10)) % 10;
}

const DIGITS_ONLY = /^\d+$/;

/** True when `code` is a well-formed EAN-13 with a correct check digit. */
export function isValidEan13(code: string): boolean {
  return code.length === 13 && DIGITS_ONLY.test(code) && eanCheckDigit(code.slice(0, 12)) === Number(code[12]);
}

export function isValidEan8(code: string): boolean {
  return code.length === 8 && DIGITS_ONLY.test(code) && eanCheckDigit(code.slice(0, 7)) === Number(code[7]);
}

export function isValidUpcA(code: string): boolean {
  return code.length === 12 && DIGITS_ONLY.test(code) && eanCheckDigit(code.slice(0, 11)) === Number(code[11]);
}

function encodeEan13(code: string): EncodedBarcode {
  const digits = code.split("").map(Number);
  const parity = EAN13_PARITY[digits[0]!]!;

  let modules = GUARD_EDGE;
  const tallBars: number[] = [];

  // Left edge guard: bars at modules 0 and 2.
  tallBars.push(0, 2);

  for (let i = 0; i < 6; i += 1) {
    const digit = digits[i + 1]!;
    modules += parity[i] === "L" ? EAN_L[digit]! : EAN_G[digit]!;
  }

  const centreStart = modules.length;
  modules += GUARD_CENTRE;
  // Centre guard bars sit at offsets 1 and 3 of "01010".
  tallBars.push(centreStart + 1, centreStart + 3);

  for (let i = 7; i < 13; i += 1) {
    modules += EAN_R[digits[i]!]!;
  }

  const rightStart = modules.length;
  modules += GUARD_EDGE;
  tallBars.push(rightStart, rightStart + 2);

  return {
    modules,
    symbology: "EAN13",
    text: code,
    tallBars,
    textGroups: [
      // The leading digit lives in the quiet zone, left of the symbol.
      { value: code.slice(0, 1), startModule: -9, endModule: -2 },
      { value: code.slice(1, 7), startModule: 3, endModule: 45 },
      { value: code.slice(7), startModule: 50, endModule: 92 },
    ],
    quietZone: 11,
  };
}

function encodeEan8(code: string): EncodedBarcode {
  const digits = code.split("").map(Number);

  let modules = GUARD_EDGE;
  const tallBars: number[] = [0, 2];

  for (let i = 0; i < 4; i += 1) modules += EAN_L[digits[i]!]!;

  const centreStart = modules.length;
  modules += GUARD_CENTRE;
  tallBars.push(centreStart + 1, centreStart + 3);

  for (let i = 4; i < 8; i += 1) modules += EAN_R[digits[i]!]!;

  const rightStart = modules.length;
  modules += GUARD_EDGE;
  tallBars.push(rightStart, rightStart + 2);

  return {
    modules,
    symbology: "EAN8",
    text: code,
    tallBars,
    textGroups: [
      { value: code.slice(0, 4), startModule: 3, endModule: 31 },
      { value: code.slice(4), startModule: 36, endModule: 64 },
    ],
    quietZone: 7,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Code 128
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The 107 Code 128 patterns, as element widths. Each is bar-space-bar-space-
 * bar-space in modules; they all total 11 except the stop pattern, which has a
 * seventh element and totals 13.
 */
const CODE128_WIDTHS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312",
  "132212", "221213", "221312", "231212", "112232", "122132", "122231", "113222",
  "123122", "123221", "223211", "221132", "221231", "213212", "223112", "312131",
  "311222", "321122", "321221", "312212", "322112", "322211", "212123", "212321",
  "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121",
  "313121", "211331", "231131", "213113", "213311", "213131", "311123", "311321",
  "331121", "312113", "312311", "332111", "314111", "221411", "431111", "111224",
  "111422", "121124", "121421", "141122", "141221", "112214", "112412", "122114",
  "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112",
  "421211", "212141", "214121", "412121", "111143", "111341", "131141", "114113",
  "114311", "411113", "411311", "113141", "114131", "311141", "411131", "211412",
  "211214", "211232", "2331112",
];

const CODE128_START_B = 104;
const CODE128_START_C = 105;
const CODE128_STOP = 106;

/** Element widths → module string, starting with a bar. */
function widthsToModules(widths: string): string {
  let out = "";
  for (let i = 0; i < widths.length; i += 1) {
    out += (i % 2 === 0 ? "1" : "0").repeat(Number(widths[i]));
  }
  return out;
}

function encodeCode128(value: string): EncodedBarcode {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 32 || code > 126) {
      throw new BarcodeError(
        `"${char}" can't be printed in a Code 128 barcode. Use letters, digits and basic punctuation.`,
      );
    }
  }

  /*
   * Subset C packs two digits into one symbol, halving the width of a numeric
   * code. Only used when the whole value is digits of even length — switching
   * subsets mid-symbol is where hand-written encoders go wrong, and an
   * unnecessarily wide but correct barcode beats a narrow one that misreads.
   */
  const useC = value.length >= 4 && value.length % 2 === 0 && DIGITS_ONLY.test(value);

  const values: number[] = [];
  if (useC) {
    values.push(CODE128_START_C);
    for (let i = 0; i < value.length; i += 2) {
      values.push(Number(value.slice(i, i + 2)));
    }
  } else {
    values.push(CODE128_START_B);
    for (const char of value) values.push(char.charCodeAt(0) - 32);
  }

  // Weighted mod-103 checksum. The start code counts once, then each data
  // symbol by its 1-based position.
  let sum = values[0]!;
  for (let i = 1; i < values.length; i += 1) sum += values[i]! * i;
  values.push(sum % 103);
  values.push(CODE128_STOP);

  const modules = values.map((v) => widthsToModules(CODE128_WIDTHS[v]!)).join("");

  return {
    modules,
    symbology: "CODE128",
    text: value,
    tallBars: [],
    textGroups: [{ value, startModule: 0, endModule: modules.length }],
    quietZone: 10,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export class BarcodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BarcodeError";
  }
}

/**
 * Pick the symbology a code is already in.
 *
 * A 13-digit number with a valid check digit is a real retail barcode and must
 * be drawn as EAN-13 — drawing it as Code 128 would produce a symbol that
 * scans back the same digits but won't match the manufacturer's label, which
 * defeats the point of having it.
 */
export function detectSymbology(code: string): Symbology {
  if (isValidEan13(code)) return "EAN13";
  if (isValidUpcA(code)) return "UPCA";
  if (isValidEan8(code)) return "EAN8";
  return "CODE128";
}

/**
 * Encode `value` for drawing.
 *
 * Pass `symbology` to force one; otherwise it's detected. A value that can't be
 * encoded throws `BarcodeError` with a message safe to show a shopkeeper — the
 * caller is usually a form field and the user can fix it.
 */
export function encodeBarcode(value: string, symbology?: Symbology): EncodedBarcode {
  const code = value.trim();
  if (!code) throw new BarcodeError("There's no code to turn into a barcode.");

  const chosen = symbology ?? detectSymbology(code);

  switch (chosen) {
    case "EAN13": {
      if (!DIGITS_ONLY.test(code)) {
        throw new BarcodeError("An EAN-13 barcode is 13 digits — no letters.");
      }
      if (code.length === 12) return encodeEan13(code + eanCheckDigit(code));
      if (code.length !== 13) {
        throw new BarcodeError(`An EAN-13 barcode needs 13 digits; this has ${code.length}.`);
      }
      if (!isValidEan13(code)) {
        throw new BarcodeError(
          `The last digit of ${code} should be ${eanCheckDigit(code.slice(0, 12))}. ` +
            "Check it against the printed label — one wrong digit is a different product.",
        );
      }
      return encodeEan13(code);
    }

    case "UPCA": {
      // UPC-A is an EAN-13 with a leading zero. Same bars, same scan.
      if (!DIGITS_ONLY.test(code) || code.length !== 12) {
        throw new BarcodeError("A UPC-A barcode needs 12 digits.");
      }
      if (!isValidUpcA(code)) {
        throw new BarcodeError(
          `The last digit of ${code} should be ${eanCheckDigit(code.slice(0, 11))}.`,
        );
      }
      const encoded = encodeEan13(`0${code}`);
      return { ...encoded, symbology: "UPCA", text: code };
    }

    case "EAN8": {
      if (!DIGITS_ONLY.test(code)) {
        throw new BarcodeError("An EAN-8 barcode is 8 digits — no letters.");
      }
      if (code.length === 7) return encodeEan8(code + eanCheckDigit(code));
      if (code.length !== 8) {
        throw new BarcodeError(`An EAN-8 barcode needs 8 digits; this has ${code.length}.`);
      }
      if (!isValidEan8(code)) {
        throw new BarcodeError(
          `The last digit of ${code} should be ${eanCheckDigit(code.slice(0, 7))}.`,
        );
      }
      return encodeEan8(code);
    }

    default:
      return encodeCode128(code);
  }
}

/** Does this value encode without throwing? For form validation. */
export function canEncode(value: string): boolean {
  try {
    encodeBarcode(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Explain why a barcode value is unusable, or null when it's fine.
 * The form shows this under the field as the user types.
 */
export function barcodeProblem(value: string): string | null {
  try {
    encodeBarcode(value);
    return null;
  } catch (error) {
    return error instanceof BarcodeError ? error.message : "That barcode can't be printed.";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Generating codes for products that don't have one
// ─────────────────────────────────────────────────────────────────────────────

/**
 * An in-store EAN-13 for an unbarcoded product — loose yams, repacked rice,
 * anything bought by the heap in a market.
 *
 * The leading "2" is reserved by GS1 for restricted distribution: codes that
 * mean something inside one shop and nothing outside it. Using a "2" prefix
 * guarantees this can never collide with a real manufacturer's barcode, which
 * is the whole reason the prefix exists.
 *
 * `orgCode` is a stable 5-digit number per organization so two shops using this
 * software don't generate the same label; `sequence` is a per-shop counter.
 *
 * The budget is exactly 12 body digits plus a check digit: "2" + 5 shop digits
 * + 6 sequence digits. That caps a shop at a million distinct labels, which no
 * supermarket will reach, and one more digit anywhere makes it a 14-digit
 * number that is not an EAN-13 at all.
 */
export function internalEan13(orgCode: number, sequence: number): string {
  const org = String(Math.abs(Math.trunc(orgCode)) % 100_000).padStart(5, "0");
  const seq = String(Math.abs(Math.trunc(sequence)) % 1_000_000).padStart(6, "0");
  const body = `2${org}${seq}`;
  return body + eanCheckDigit(body);
}

/**
 * A stable 5-digit shop code derived from the organization id.
 *
 * Deterministic on purpose: the same shop always produces the same prefix, so a
 * label printed today and one printed next year sit in the same number space,
 * and nothing needs to be stored to make that true.
 */
export function orgBarcodeCode(organizationId: string): number {
  let hash = 0;
  for (let i = 0; i < organizationId.length; i += 1) {
    hash = (hash * 31 + organizationId.charCodeAt(i)) % 100_000;
  }
  return hash;
}

/**
 * A readable SKU from a product name: "Golden Penny Semovita 1kg" → "GOL-SEM-1KG".
 *
 * SKUs get typed by hand when a scanner won't read a crushed label, so they're
 * short, upper-case and unambiguous. The caller appends a counter if this
 * collides — uniqueness is the database's job, not this function's.
 */
export function suggestSku(name: string): string {
  const words = name
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) return "ITEM";

  return words
    .slice(0, 3)
    .map((word) => (/\d/.test(word) ? word : word.slice(0, 3)))
    .join("-")
    .slice(0, 24);
}
