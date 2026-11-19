import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { siteUrl } from "./site";

/**
 * Your bank details for plan payments, and the private "I've paid" link.
 *
 * The bank details live in environment variables on purpose: they are your own
 * account, and a web form to edit them is the first thing someone with a stolen
 * console login would change. Set them on Vercel (and in .env locally).
 */
export function paymentDetails(): { bank: string; accountName: string; accountNumber: string } | null {
  const bank = process.env.PAYMENT_BANK_NAME?.trim();
  const accountName = process.env.PAYMENT_ACCOUNT_NAME?.trim();
  const accountNumber = process.env.PAYMENT_ACCOUNT_NUMBER?.trim();
  if (!bank || !accountName || !accountNumber) return null;
  return { bank, accountName, accountNumber };
}

/** Where your sales emails and customers' replies should land. */
export function salesInbox(): string | null {
  return process.env.SALES_NOTIFICATION_EMAIL?.trim() || process.env.PLATFORM_ADMIN_EMAIL?.trim() || null;
}

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET must be set (32+ characters).");
  return s;
}

/**
 * A token only the customer's email contains. References like CW-0012 are easy
 * to guess, so the "I've paid" page also needs this, or anyone could mark
 * someone else's request as paid.
 */
export function payToken(leadId: string): string {
  return createHmac("sha256", secret()).update(`lead-pay:${leadId}`).digest("base64url").slice(0, 32);
}

export function checkPayToken(leadId: string, token: string | null | undefined): boolean {
  if (!token) return false;
  const expected = Buffer.from(payToken(leadId));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function payLink(lead: { id: string; reference: string }): string {
  return `${siteUrl()}/pay/${encodeURIComponent(lead.reference)}?t=${payToken(lead.id)}`;
}
