import { z } from "zod";

/**
 * How a shop's receipt looks. Stored as one JSON value on OrgSettings so new
 * options never need a migration; every field has a default, so an empty or
 * older value always reads as a complete design.
 *
 * Shared by the till (to print), the designer (to preview) and the API (to
 * check what is saved). No server-only imports here.
 */

export const RECEIPT_STYLES = ["CLASSIC", "MODERN", "BOLD"] as const;
export type ReceiptStyle = (typeof RECEIPT_STYLES)[number];

export const RECEIPT_STYLE_INFO: Record<ReceiptStyle, { label: string; hint: string }> = {
  CLASSIC: { label: "Classic", hint: "Typewriter lettering and dashed lines, like a traditional till slip." },
  MODERN: { label: "Modern", hint: "Clean lettering, light rules, the total in a box." },
  BOLD: { label: "Bold", hint: "Big shop name and a solid black total bar that stands out." },
};

export const receiptDesignSchema = z.object({
  style: z.enum(RECEIPT_STYLES).default("MODERN"),
  font: z.enum(["MONO", "SANS"]).default("SANS"),
  textSize: z.enum(["SMALL", "NORMAL", "LARGE"]).default("NORMAL"),
  headerAlign: z.enum(["CENTER", "LEFT"]).default("CENTER"),
  showAddress: z.boolean().default(true),
  showPhone: z.boolean().default(true),
  /**
   * Numbers to print, up to four (sales line, WhatsApp, delivery...). Empty
   * means "use the business phone from Settings".
   */
  phones: z.array(z.string().trim().min(5).max(30)).max(4).default([]),
  showBranch: z.boolean().default(true),
  showUnitPrice: z.boolean().default(true),
  showItemCount: z.boolean().default(true),
  showSavings: z.boolean().default(true),
  showBarcode: z.boolean().default(true),
  /** e.g. "TIN 12345678-0001" or "RC 123456". */
  taxId: z.string().trim().max(40).default(""),
  /** e.g. "IG @demomart  ·  www.demomart.ng". */
  extraLine: z.string().trim().max(80).default(""),
});

export type ReceiptDesign = z.infer<typeof receiptDesignSchema>;

export const DEFAULT_RECEIPT_DESIGN: ReceiptDesign = receiptDesignSchema.parse({});

/** Read whatever is stored (null, old shape, junk) as a complete design. */
export function parseReceiptDesign(value: unknown): ReceiptDesign {
  const parsed = receiptDesignSchema.safeParse(value && typeof value === "object" ? value : {});
  return parsed.success ? parsed.data : DEFAULT_RECEIPT_DESIGN;
}

/** Who may change the receipt: main admins, sub-admins, managers, or anyone allowed to change settings. */
export function canDesignReceipt(user: { role: string; permissions: readonly string[] }): boolean {
  return ["MAIN_ADMIN", "SUB_ADMIN", "MANAGER"].includes(user.role) || user.permissions.includes("settings.manage");
}

/** The phone numbers a receipt should print. */
export function receiptPhones(design: ReceiptDesign, businessPhone: string | null): string[] {
  if (!design.showPhone) return [];
  const list = design.phones.filter(Boolean);
  if (list.length > 0) return list;
  return businessPhone ? [businessPhone] : [];
}

/**
 * Paper the receipt prints on. 80mm and 58mm are till rolls (thermal
 * printers). A4 is a normal office printer: the receipt becomes a full-page
 * invoice layout and always prints through the browser's print window, because
 * office printers don't understand till-printer (ESC/POS) commands.
 */
export const RECEIPT_WIDTHS = ["80mm", "58mm", "A4"] as const;
export type ReceiptWidth = (typeof RECEIPT_WIDTHS)[number];

/** Whatever is stored, read it as a width we know, defaulting to 80mm. */
export function toReceiptWidth(value: unknown): ReceiptWidth {
  return (RECEIPT_WIDTHS as readonly unknown[]).includes(value) ? (value as ReceiptWidth) : "80mm";
}
