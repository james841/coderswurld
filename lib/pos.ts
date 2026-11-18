import { z } from "zod";

import type { PaymentMethod, PriceMode } from "./constants";
import { lineTotal } from "./money";

/**
 * The till's shared vocabulary — the one module imported by both sides of the
 * POS.
 *
 * It is deliberately free of any `server-only` dependency (no db, no auth, no
 * stock ledger) so the browser can import the exact same price-resolution and
 * totals maths the server runs. The alternative — the till computing a total
 * one way and the server another — is the bug where a receipt says ₦4,950 and
 * the sales report says ₦5,000, and nobody can say which is right. There is one
 * implementation of "what does this cart cost", and it lives here.
 *
 * WHAT THE TILL IS AND ISN'T TRUSTED WITH
 * ---------------------------------------
 * The client sends quantities, the chosen price mode, discounts and payments.
 * It never sends cost price, and the server never trusts a selling price it
 * didn't derive itself: cost and the authoritative unit price are read from the
 * product row inside the sale transaction. A tampered client can therefore
 * change what it *asks* to sell, but not what the ledger records it sold for —
 * unless the cashier holds the price-override permission, which is the one case
 * a sent price is honoured.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Catalog sync payloads
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A product as the till holds it in IndexedDB. No cost price: a cashier has no
 * business seeing margin, and nothing on this screen needs it.
 */
export interface CatalogProduct {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  unit: string;
  categoryId: string | null;
  categoryName: string | null;
  sellingPriceKobo: number;
  wholesalePriceKobo: number;
  wholesaleMinQty: number;
  imageThumb: string | null;
  trackExpiry: boolean;
  expiryDate: string | null;
  /** Deactivated products ride the delta too, so the till can drop them. */
  isActive: boolean;
  version: number;
  /** SUPERMARKET | PHARMACY. Missing on catalogues saved before departments. */
  department?: string;
}

/** One branch stock figure. Short keys because this is the bulky part of a sync. */
export interface CatalogStock {
  p: string;
  q: number;
}

/**
 * The answer to "what changed since I last synced?".
 *
 * `upserts` are products with a version above the one the client holds;
 * `catalogVersion` is where the client should set its cursor afterwards. Stock
 * rides its own cursor (`updatedAt`) because it moves on every sale, not on
 * catalog edits — syncing the two together but tracking them apart is what
 * keeps a steady-state poll tiny.
 */
export interface SyncResponse {
  catalogVersion: number;
  /** True on a first/forced download: the client should replace, not merge. */
  full: boolean;
  upserts: CatalogProduct[];
  stock: CatalogStock[];
  stockFull: boolean;
  /** ISO. The client stores this and sends it back as the next stock cursor. */
  serverTime: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pricing
// ─────────────────────────────────────────────────────────────────────────────

export type PriceType = PriceMode; // "RETAIL" | "WHOLESALE"

/**
 * Which price a line gets, and why.
 *
 * Wholesale applies when the till is in wholesale mode, or when auto-wholesale
 * is on and the quantity reaches the product's threshold — the behaviour a
 * shopkeeper means by "a carton is cheaper than twelve singles". A product with
 * no wholesale price set never switches, whatever the quantity: zero is not a
 * price, it is "not offered".
 */
export function resolveUnitPrice(
  product: {
    sellingPriceKobo: number;
    wholesalePriceKobo: number;
    wholesaleMinQty: number;
  },
  quantity: number,
  mode: PriceMode,
  autoWholesale: boolean,
): { unitPriceKobo: number; priceType: PriceType } {
  const wholesaleOffered = product.wholesalePriceKobo > 0;
  const hitsThreshold =
    product.wholesaleMinQty > 0 && quantity >= product.wholesaleMinQty;

  if (wholesaleOffered && (mode === "WHOLESALE" || (autoWholesale && hitsThreshold))) {
    return { unitPriceKobo: product.wholesalePriceKobo, priceType: "WHOLESALE" };
  }
  return { unitPriceKobo: product.sellingPriceKobo, priceType: "RETAIL" };
}

export interface TotalsLine {
  unitPriceKobo: number;
  quantity: number;
  discountKobo: number;
}

export interface Totals {
  subtotalKobo: number;
  lineDiscountKobo: number;
  orderDiscountKobo: number;
  /** Every naira taken off: line discounts plus the order-level one. */
  discountKobo: number;
  taxKobo: number;
  totalKobo: number;
}

export interface VatConfig {
  enabled: boolean;
  basisPoints: number;
  inclusive: boolean;
}

/**
 * The one place a cart becomes a bill.
 *
 * Subtotal is the sum of line totals (each already net of its own discount and
 * clamped at zero by `lineTotal`). The order discount comes off that, clamped
 * so a fat-fingered ₦99,999 discount on a ₦500 sale can't drive the total
 * negative. VAT is computed last: inclusive VAT is carved out of the total for
 * the receipt without changing what the customer pays, exclusive VAT is added
 * on top. Off by default, which is how most small shops run.
 */
export function computeTotals(
  lines: TotalsLine[],
  orderDiscountKobo: number,
  vat?: VatConfig,
): Totals {
  let subtotalKobo = 0;
  let lineDiscountKobo = 0;

  for (const line of lines) {
    const gross = Math.round(line.unitPriceKobo * line.quantity);
    const net = lineTotal(line.unitPriceKobo, line.quantity, line.discountKobo);
    subtotalKobo += net;
    lineDiscountKobo += Math.min(line.discountKobo, gross);
  }

  const orderDiscount = Math.max(0, Math.min(orderDiscountKobo, subtotalKobo));
  const netKobo = subtotalKobo - orderDiscount;

  let taxKobo = 0;
  let totalKobo = netKobo;
  if (vat?.enabled && vat.basisPoints > 0) {
    if (vat.inclusive) {
      // Price already contains the tax; show how much of it is VAT.
      taxKobo = Math.round((netKobo * vat.basisPoints) / (10_000 + vat.basisPoints));
    } else {
      taxKobo = Math.round((netKobo * vat.basisPoints) / 10_000);
      totalKobo = netKobo + taxKobo;
    }
  }

  return {
    subtotalKobo,
    lineDiscountKobo,
    orderDiscountKobo: orderDiscount,
    discountKobo: lineDiscountKobo + orderDiscount,
    taxKobo,
    totalKobo,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Settlement
// ─────────────────────────────────────────────────────────────────────────────

export interface SettlementInput {
  totalKobo: number;
  /** Each payment's amount is what it settles toward the bill, never change. */
  payments: { method: PaymentMethod; amountKobo: number }[];
  /** Physical cash handed over. Only cash produces change. */
  tenderedKobo: number;
}

export interface Settlement {
  paidKobo: number;
  balanceKobo: number;
  changeKobo: number;
  method: PaymentMethod;
}

/**
 * Turn a list of payments into the four numbers a sale records.
 *
 * `paidKobo` is clamped at the total: you cannot over-pay a bill into the
 * ledger, the surplus is change. `balanceKobo` is the unpaid remainder — a
 * positive balance is a credit sale by definition, whatever buttons were
 * pressed. Change is cash-only and comes from the physical tender, not from the
 * applied amounts, so a ₦5,000 note against a ₦4,850 bill returns ₦150 whether
 * or not the cashier typed anything.
 */
export function settle(input: SettlementInput): Settlement {
  const applied = input.payments.reduce((sum, p) => sum + Math.max(0, p.amountKobo), 0);
  const paidKobo = Math.min(applied, input.totalKobo);
  const balanceKobo = Math.max(0, input.totalKobo - paidKobo);

  const cashApplied = input.payments
    .filter((p) => p.method === "CASH")
    .reduce((sum, p) => sum + Math.max(0, p.amountKobo), 0);
  const changeKobo = Math.max(0, input.tenderedKobo - cashApplied);

  let method: PaymentMethod;
  if (input.payments.length > 1) {
    method = "SPLIT";
  } else if (input.payments.length === 1) {
    method = input.payments[0].method;
  } else {
    method = "CREDIT";
  }
  // A sale left owing is a credit sale regardless of what was tendered toward it.
  if (balanceKobo > 0 && input.payments.length <= 1) {
    method = "CREDIT";
  }

  return { paidKobo, balanceKobo, changeKobo, method };
}

// ─────────────────────────────────────────────────────────────────────────────
// Submission schema — the wire contract for POST /api/pos/sales
// ─────────────────────────────────────────────────────────────────────────────

const paymentMethodEnum = z.enum(["CASH", "TRANSFER", "POS", "CREDIT", "SPLIT"]);

export const saleLineSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().positive().finite(),
  /**
   * A price the cashier typed over the catalog price. Honoured only when the
   * cashier holds POS_PRICE_OVERRIDE; ignored otherwise, so sending it is never
   * a way around the permission.
   */
  overrideUnitPriceKobo: z.number().int().nonnegative().optional(),
  discountKobo: z.number().int().nonnegative().default(0),
  /**
   * Retail or wholesale for THIS item. One customer can take one product at
   * retail and the next at wholesale. Missing on sales queued by an older till,
   * which fall back to the sale-level `priceMode`.
   */
  priceMode: z.enum(["RETAIL", "WHOLESALE"]).optional(),
});

export const salePaymentSchema = z.object({
  method: paymentMethodEnum,
  amountKobo: z.number().int().nonnegative(),
});

export const saleSubmitSchema = z.object({
  /**
   * The idempotency key: a UUID minted on the till before the sale is sent.
   * Replaying a queued offline sale carries the same key, and the unique index
   * on (organizationId, localId) turns a double-post into a no-op.
   */
  localId: z.string().min(8).max(64),
  deviceId: z.string().min(1).max(80).optional(),
  priceMode: z.enum(["RETAIL", "WHOLESALE"]).default("RETAIL"),
  lines: z.array(saleLineSchema).min(1, "A sale needs at least one item."),
  orderDiscountKobo: z.number().int().nonnegative().default(0),
  payments: z.array(salePaymentSchema).max(5).default([]),
  tenderedKobo: z.number().int().nonnegative().default(0),
  customerId: z.string().min(1).nullish(),
  note: z.string().trim().max(500).nullish(),
  /** The till's wall-clock time of the sale — set when it was made offline. */
  soldAt: z.string().datetime().optional(),
});

export type SaleSubmit = z.infer<typeof saleSubmitSchema>;
export type SaleLineSubmit = z.infer<typeof saleLineSchema>;
export type SalePaymentSubmit = z.infer<typeof salePaymentSchema>;

/** What the till gets back and reconciles its IndexedDB against. */
export interface SaleResult {
  ok: true;
  /** True when this exact localId had already been recorded — a safe replay. */
  duplicate: boolean;
  sale: {
    id: string;
    receiptNo: string;
    soldAt: string;
    subtotalKobo: number;
    discountKobo: number;
    taxKobo: number;
    totalKobo: number;
    paidKobo: number;
    balanceKobo: number;
    tenderedKobo: number;
    changeKobo: number;
    paymentMethod: PaymentMethod;
    priceMode: PriceMode;
    customerId: string | null;
  };
  /** Fresh branch quantities for the sold products, so the till self-corrects. */
  stock: CatalogStock[];
}
