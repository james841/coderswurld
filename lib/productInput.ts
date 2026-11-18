import { z } from "zod";

import { PRODUCT_UNITS } from "./constants";
import { parseMoneyInput } from "./money";

/**
 * Product input validation and normalisation, shared by the API routes and the
 * client form.
 *
 * WHY THE SCHEMA LIVES OUTSIDE THE ROUTE
 * --------------------------------------
 * The form needs to show the same messages the API would return, without a round
 * trip — and, more importantly, the two must not drift. A field the form marks
 * optional and the API marks required is a bug the user finds, not the compiler.
 * `lib/constants.ts` carries no `server-only` marker, so importing this from a
 * client component is safe.
 *
 * MONEY ENTERS AS A STRING
 * ------------------------
 * Prices arrive as whatever the user typed: "1,250", "₦1250.50", "1250". They are
 * parsed once, here, into integer kobo, and every consumer downstream sees only
 * the integer. Letting a float through the boundary is how a till ends up
 * computing change with 0.30000000000000004.
 */

/** A money field that arrives as typed text and becomes integer kobo. */
const moneyField = (label: string) =>
  z
    .union([z.string(), z.number()])
    .transform((value, ctx) => {
      if (typeof value === "number") {
        if (!Number.isFinite(value)) {
          ctx.addIssue({ code: "custom", message: `Enter a valid ${label}.` });
          return z.NEVER;
        }
        return Math.round(value);
      }
      const trimmed = value.trim();
      if (trimmed === "") return 0;
      const parsed = parseMoneyInput(trimmed);
      if (Number.isNaN(parsed)) {
        ctx.addIssue({ code: "custom", message: `Enter a valid ${label}.` });
        return z.NEVER;
      }
      if (parsed < 0) {
        ctx.addIssue({ code: "custom", message: `${label} cannot be negative.` });
        return z.NEVER;
      }
      // Kobo in, kobo out. A shop that needs sub-kobo pricing does not exist,
      // and rounding here is what keeps the rest of the system in integers.
      return Math.round(parsed * 100);
    })
    .pipe(z.number().int().min(0).max(9_999_999_999));

/** A quantity that may be fractional — 0.75 kg of rice is a real line item. */
const quantityField = z
  .union([z.string(), z.number()])
  .transform((value, ctx) => {
    const parsed = typeof value === "number" ? value : Number(String(value).replace(/[^0-9.\-]/g, ""));
    if (!Number.isFinite(parsed)) {
      ctx.addIssue({ code: "custom", message: "Enter a number." });
      return z.NEVER;
    }
    return parsed;
  })
  .pipe(z.number().min(0).max(9_999_999));

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null));

const UNIT_VALUES = PRODUCT_UNITS.map((u) => u.value) as [string, ...string[]];

/**
 * The write shape.
 *
 * `openingStock` is not a `Product` column — it is the quantity that seeds the
 * ledger at create time, and it is here rather than in a separate endpoint
 * because a shopkeeper adding "50 bags of rice" thinks of that as one action.
 */
export const ProductInputSchema = z.object({
  name: z.string().trim().min(2, "Give the product a name.").max(160),

  sku: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((v) => (v && v.length > 0 ? v.toUpperCase() : null)),

  barcode: z
    .string()
    .trim()
    .max(64)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),

  categoryId: z.string().trim().max(40).nullish().transform((v) => v || null),
  /** Supermarket or Pharmacy. Ignored unless the shop has departments on. */
  department: z.enum(["SUPERMARKET", "PHARMACY"]).optional(),
  supplierId: z.string().trim().max(40).nullish().transform((v) => v || null),

  description: optionalText(2000),
  unit: z.enum(UNIT_VALUES).default("pcs"),
  packSize: optionalText(60),

  costPrice: moneyField("cost price").default(0),
  sellingPrice: moneyField("selling price").default(0),
  wholesalePrice: moneyField("wholesale price").default(0),
  wholesaleMinQty: z.coerce.number().int().min(1).max(100_000).default(12),

  minStock: quantityField.default(0),
  /** Quantity at the branch on create. Ignored on edit — stock moves via the ledger. */
  openingStock: quantityField.optional(),

  trackExpiry: z.coerce.boolean().default(false),
  expiryDate: z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v && v.length > 0 ? new Date(v) : null))
    .refine((d) => d === null || !Number.isNaN(d.getTime()), "Enter a valid date."),

  imageUrl: optionalText(500),
  imageThumb: optionalText(4000),
});

export type ProductInput = z.infer<typeof ProductInputSchema>;

/**
 * The same shape for edits, where every field is optional so a PATCH that only
 * changes a price doesn't blank the description.
 */
export const ProductPatchSchema = ProductInputSchema.partial();

export type ProductPatch = z.infer<typeof ProductPatchSchema>;

export const ProductQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  categoryId: z.string().trim().max(40).optional(),
  supplierId: z.string().trim().max(40).optional(),
  department: z.enum(["SUPERMARKET", "PHARMACY"]).optional(),
  /** LOW | OUT | EXPIRING | EXPIRED | NONE — the stock health filter. */
  stock: z.enum(["LOW", "OUT", "EXPIRING", "EXPIRED"]).optional(),
  sort: z
    .enum(["name", "recent", "price", "stock", "expiry"])
    .default("recent"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  perPage: z.coerce.number().int().min(10).max(100).default(25),
  includeInactive: z.coerce.boolean().default(false),
});

export type ProductQuery = z.infer<typeof ProductQuerySchema>;

/**
 * Cross-field checks that a field-level schema can't express.
 *
 * These are the rules a shopkeeper would state out loud, so the messages are
 * written the way they'd say them.
 */
export function productBusinessRules(input: {
  costPrice?: number;
  sellingPrice?: number;
  wholesalePrice?: number;
  trackExpiry?: boolean;
  expiryDate?: Date | null;
  name?: string;
}): Record<string, string> {
  const problems: Record<string, string> = {};

  const cost = input.costPrice ?? 0;
  const selling = input.sellingPrice ?? 0;
  const wholesale = input.wholesalePrice ?? 0;

  /*
   * Selling below cost is not an error — clearance and loss-leaders are real,
   * and a shop that has already bought the stock sometimes has to. It is a
   * warning the form shows, and the API allows it. Blocking it would make the
   * software argue with someone about their own business.
   */

  if (wholesale > 0 && selling > 0 && wholesale > selling) {
    problems.wholesalePrice =
      "Wholesale is above the retail price — bulk buyers would pay more than walk-ins.";
  }

  if (cost > 0 && selling === 0) {
    problems.sellingPrice = "You've entered a cost but no selling price.";
  }

  if (input.trackExpiry && !input.expiryDate) {
    problems.expiryDate = "Add the expiry date, or turn expiry tracking off.";
  }

  if (input.expiryDate && input.trackExpiry === false) {
    // The reverse: a date with tracking off is silently ignored, which is worse
    // than saying so, since the product then never appears in expiry alerts.
    problems.trackExpiry = "Turn expiry tracking on for this date to be watched.";
  }

  return problems;
}
