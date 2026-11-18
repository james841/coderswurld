/**
 * Money handling. Every amount in this system is an integer number of kobo.
 *
 * Why: a till that computes change with floating point will eventually hand a
 * customer ₦0.01 too little and the shop owner will not trust the software
 * again. 0.1 + 0.2 !== 0.3 is not an abstract problem when it is someone's
 * money. Integers are exact; we only convert at the UI edge.
 *
 *   ₦1,250.50  ->  125050 kobo
 */

/** 100 kobo to the naira. */
export const KOBO_PER_NAIRA = 100;

/**
 * Naira (possibly a string from an input) -> kobo.
 * Rounds to the nearest kobo; returns 0 for anything unparseable so a bad
 * keystroke can never poison a total with NaN.
 */
export function toKobo(naira: number | string | null | undefined): number {
  if (naira === null || naira === undefined || naira === "") return 0;
  const n = typeof naira === "number" ? naira : parseMoneyInput(naira);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * KOBO_PER_NAIRA);
}

/** Kobo -> naira as a float. Only for display or export, never for arithmetic. */
export function fromKobo(kobo: number | null | undefined): number {
  if (!kobo || !Number.isFinite(kobo)) return 0;
  return kobo / KOBO_PER_NAIRA;
}

/**
 * Accepts what people actually type: "1,250.50", "₦1250", " 1 250 ", "1250.5".
 * Returns NaN only when there is genuinely no number in there.
 */
export function parseMoneyInput(raw: string): number {
  const cleaned = String(raw).replace(/[^0-9.\-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return NaN;
  return Number(cleaned);
}

const nairaFormatter = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const nairaWholeFormatter = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/**
 * Format kobo for display.
 *
 * Kobo are dropped when the amount is a whole naira, because Nigerian retail
 * prices almost never carry kobo and "₦1,250" reads faster at a till than
 * "₦1,250.00". Pass `alwaysShowKobo` where exactness matters (receipts, change).
 */
export function formatNaira(
  kobo: number | null | undefined,
  options: { alwaysShowKobo?: boolean } = {},
): string {
  const value = fromKobo(kobo);
  if (!options.alwaysShowKobo && Number.isInteger(value)) {
    return nairaWholeFormatter.format(value);
  }
  return nairaFormatter.format(value);
}

/** Like formatNaira but without the currency symbol — for table columns. */
export function formatAmount(kobo: number | null | undefined): string {
  const value = fromKobo(kobo);
  return new Intl.NumberFormat("en-NG", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** "₦1.2m" / "₦485k" — for dashboard tiles where space is tight. */
export function formatNairaCompact(kobo: number | null | undefined): string {
  const value = fromKobo(kobo);
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `₦${trim(value / 1_000_000_000)}b`;
  if (abs >= 1_000_000) return `₦${trim(value / 1_000_000)}m`;
  if (abs >= 10_000) return `₦${trim(value / 1_000)}k`;
  return formatNaira(kobo);
}

function trim(n: number): string {
  return n.toFixed(1).replace(/\.0$/, "");
}

/**
 * Change owed to a customer. Clamped at zero: a negative "change" is an
 * underpayment, which is a different concept (a balance) and is tracked
 * separately on the sale. Never show a negative change on a receipt.
 */
export function calculateChange(tenderedKobo: number, totalKobo: number): number {
  return Math.max(0, tenderedKobo - totalKobo);
}

/** Shortfall when the customer hasn't covered the total. Zero when fully paid. */
export function calculateBalance(tenderedKobo: number, totalKobo: number): number {
  return Math.max(0, totalKobo - tenderedKobo);
}

/**
 * Line total for a cart row. Discount is applied to the line, then clamped so a
 * fat-fingered discount can never produce a negative line.
 *
 * Quantity may be fractional (0.75 kg), so the product is rounded once, here —
 * this is the single place where a non-integer touches money.
 */
export function lineTotal(
  unitPriceKobo: number,
  quantity: number,
  discountKobo = 0,
): number {
  const gross = Math.round(unitPriceKobo * quantity);
  return Math.max(0, gross - discountKobo);
}

/** Margin as a percentage of selling price. 0 when the price is 0. */
export function marginPercent(costKobo: number, sellingKobo: number): number {
  if (sellingKobo <= 0) return 0;
  return ((sellingKobo - costKobo) / sellingKobo) * 100;
}

/** Markup as a percentage of cost. 0 when cost is 0. */
export function markupPercent(costKobo: number, sellingKobo: number): number {
  if (costKobo <= 0) return 0;
  return ((sellingKobo - costKobo) / costKobo) * 100;
}

/**
 * Denominations in circulation, largest first. Used by the POS to offer
 * one-tap tender buttons and to suggest how to make up the change.
 */
export const NAIRA_DENOMINATIONS_KOBO = [
  100_000_00, 50_000_00, 20_000_00, 10_000_00, 5_000_00, 2_000_00, 1_000_00,
  500_00, 200_00, 100_00, 50_00,
].filter((v, i, a) => a.indexOf(v) === i);

/**
 * Quick-tender suggestions: the exact amount, then the next few "round" notes
 * a customer would realistically hand over. Keeps the cashier off the keypad
 * for the common case.
 */
export function suggestTenderAmounts(totalKobo: number, count = 4): number[] {
  if (totalKobo <= 0) return [];
  const suggestions = new Set<number>([totalKobo]);

  // Round up to the next 500, 1k, 5k, 10k — whichever are above the total.
  for (const step of [500_00, 1_000_00, 5_000_00, 10_000_00]) {
    const rounded = Math.ceil(totalKobo / step) * step;
    if (rounded > totalKobo) suggestions.add(rounded);
  }

  // Single notes that would cover it outright.
  for (const note of [...NAIRA_DENOMINATIONS_KOBO].reverse()) {
    if (note >= totalKobo) suggestions.add(note);
  }

  return [...suggestions].sort((a, b) => a - b).slice(0, count);
}

/**
 * Break an amount into notes, largest first — so the cashier can count out
 * change without doing mental arithmetic under queue pressure.
 */
export function breakdownIntoNotes(
  kobo: number,
): { denominationKobo: number; count: number }[] {
  let remaining = kobo;
  const out: { denominationKobo: number; count: number }[] = [];
  for (const d of NAIRA_DENOMINATIONS_KOBO) {
    if (remaining < d) continue;
    const count = Math.floor(remaining / d);
    remaining -= count * d;
    out.push({ denominationKobo: d, count });
  }
  return out;
}
