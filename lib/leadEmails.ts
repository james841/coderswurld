import "server-only";

import { BUSINESS_TYPE_LABELS, getPlan } from "./constants";
import {
  emailAmount,
  emailBankCard,
  emailButton,
  emailCallout,
  emailP,
  emailShell,
  emailSteps,
  emailTable,
  escapeHtml,
  sendMail,
  type DeliveryResult,
} from "./mail";
import { formatNaira } from "./money";
import { payLink, paymentDetails, salesInbox } from "./payment";
import { siteUrl } from "./site";

/**
 * Every email in the plan-request journey, in one place:
 *
 *   customer picks a plan  -> paymentInstructions (to them) + newRequestAlert (to you)
 *   customer taps I've paid -> paymentClaimAlert (to you) + claimReceived (to them)
 *   you approve             -> the welcome email with their login (lib/provision.ts)
 *
 * Customer emails carry your sales inbox as Reply-To, so a reply (with a
 * transfer screenshot, say) reaches you, not the no-reply sender.
 */

export interface LeadForEmail {
  id: string;
  reference: string;
  companyName: string;
  businessType: string;
  contactName: string;
  contactRole?: string | null;
  email: string;
  phone: string;
  city?: string | null;
  state?: string | null;
  branchCount: number;
  staffCount: number;
  plan: string;
  quotedKobo: number;
  notes?: string | null;
}

const first = (name: string) => escapeHtml(name.trim().split(/\s+/)[0] || name);

/** To the customer, straight after they pick a plan (and again if you resend it). */
export async function sendPaymentInstructions(lead: LeadForEmail): Promise<DeliveryResult> {
  const plan = getPlan(lead.plan);
  const bank = paymentDetails();
  const amount = formatNaira(lead.quotedKobo || plan.priceKobo);
  const link = payLink(lead);

  const body = bank
    ? `
${emailP(`Hello ${first(lead.contactName)},`)}
${emailP(`Thank you for choosing Coderswurld Inventory for <strong>${escapeHtml(lead.companyName)}</strong>. To activate your <strong>${escapeHtml(plan.name)}</strong> plan, make one transfer for the year. There is no monthly charge.`)}
${emailAmount(amount, `${escapeHtml(plan.name)} plan, 12 months &nbsp;·&nbsp; Reference ${escapeHtml(lead.reference)}`)}
${emailBankCard({ ...bank, narration: lead.reference })}
${emailCallout(`Please write <strong>${escapeHtml(lead.reference)}</strong> as the transfer narration (description), so we can match your payment straight away.`, "warn")}
<p style="margin:0 0 10px;font-size:15px;font-weight:800;color:#0f172a;">Already paid? Tell us in one tap</p>
${emailButton(link, "I've made the payment")}
${emailSteps([
  "Make the transfer to the account above.",
  "Tap <strong>I've made the payment</strong> and tell us the name on the transfer.",
  "We confirm it, then email your main admin login. Usually within a few hours on a working day.",
])}
${emailP(`You can also reply to this email with your transfer receipt. We never ask for card details or PINs.`, { muted: true, size: 13.5 })}`
    : `
${emailP(`Hello ${first(lead.contactName)},`)}
${emailP(`Thank you for choosing Coderswurld Inventory for <strong>${escapeHtml(lead.companyName)}</strong>. We have your request for the <strong>${escapeHtml(plan.name)}</strong> plan (${amount} for 12 months).`)}
${emailCallout(`We'll reply to this email shortly with our bank details. Your reference is <strong>${escapeHtml(lead.reference)}</strong>.`)}`;

  return sendMail({
    to: lead.email,
    replyTo: salesInbox() ?? undefined,
    subject: bank
      ? `Pay ${amount} to activate your ${plan.name} plan (${lead.reference})`
      : `Your ${plan.name} plan request (${lead.reference})`,
    html: emailShell({
      eyebrow: `Plan request ${lead.reference}`,
      heading: bank ? "One step to activate your account" : "We've got your request",
      preheader: bank
        ? `${amount} by bank transfer. Use ${lead.reference} as the narration.`
        : `Reference ${lead.reference}. Bank details on the way.`,
      body,
      footer: `You're receiving this because you requested a plan at Coderswurld Inventory. Quote <strong>${escapeHtml(lead.reference)}</strong> on any reply.`,
    }),
  });
}

/** To you, when someone picks a plan. */
export async function sendNewRequestAlert(lead: LeadForEmail): Promise<DeliveryResult | null> {
  const to = salesInbox();
  if (!to) return null;
  const plan = getPlan(lead.plan);
  const amount = formatNaira(lead.quotedKobo || plan.priceKobo);
  const body = `
${emailP(`<strong>${escapeHtml(lead.companyName)}</strong> wants the <strong>${escapeHtml(plan.name)}</strong> plan. ${paymentDetails() ? "Your bank details have been emailed to them." : "<span style=\"color:#b91c1c;font-weight:700;\">Bank details are not set, so they were told you'll send them.</span>"}`)}
${emailTable([
  ["Reference", `<span style="font-family:monospace;">${escapeHtml(lead.reference)}</span>`],
  ["Plan", `${escapeHtml(plan.name)}, ${amount}/year`],
  ["Business", escapeHtml(lead.companyName)],
  ["Type", escapeHtml(BUSINESS_TYPE_LABELS[lead.businessType as keyof typeof BUSINESS_TYPE_LABELS] ?? lead.businessType)],
  ["Contact", `${escapeHtml(lead.contactName)}${lead.contactRole ? ` (${escapeHtml(lead.contactRole)})` : ""}`],
  ["Email", `<a href="mailto:${escapeHtml(lead.email)}" style="color:#c2410c;">${escapeHtml(lead.email)}</a>`],
  ["Phone", `<a href="tel:${escapeHtml(lead.phone)}" style="color:#c2410c;">${escapeHtml(lead.phone)}</a>`],
  ["Location", escapeHtml([lead.city, lead.state].filter(Boolean).join(", ") || "Not given")],
  ["Size", `${lead.branchCount} branch${lead.branchCount === 1 ? "" : "es"}, ${lead.staffCount} staff`],
])}
${lead.notes ? emailCallout(`<strong>Their note:</strong><br>${escapeHtml(lead.notes).replace(/\n/g, "<br>")}`) : ""}
${emailButton(`${siteUrl()}/platform/leads/${lead.id}`, "Open in the console", "navy")}`;

  return sendMail({
    to,
    replyTo: lead.email,
    subject: `[${lead.reference}] New ${plan.name} request: ${lead.companyName}`,
    html: emailShell({
      eyebrow: "New plan request",
      heading: `${lead.companyName} wants ${plan.name}`,
      preheader: `${amount}/year. ${lead.contactName}, ${lead.phone}`,
      body,
      footer: `Reply to this email to reach ${escapeHtml(lead.contactName)} directly.`,
    }),
  });
}

export interface PaymentClaim {
  senderName: string;
  amountKobo: number;
  paidOn: Date;
  bank: string | null;
  note: string | null;
}

const day = (d: Date) =>
  new Intl.DateTimeFormat("en-NG", { timeZone: "Africa/Lagos", day: "numeric", month: "long", year: "numeric" }).format(d);

/** To you, when a customer taps "I've made the payment". */
export async function sendPaymentClaimAlert(lead: LeadForEmail, claim: PaymentClaim): Promise<DeliveryResult | null> {
  const to = salesInbox();
  if (!to) return null;
  const plan = getPlan(lead.plan);
  const expected = lead.quotedKobo || plan.priceKobo;
  const short = claim.amountKobo < expected;
  const body = `
${emailP(`<strong>${escapeHtml(lead.companyName)}</strong> says they've paid for the <strong>${escapeHtml(plan.name)}</strong> plan. Check your bank for this transfer, then approve them in the console.`)}
${emailTable([
  ["Reference", `<span style="font-family:monospace;">${escapeHtml(lead.reference)}</span>`],
  ["Name on transfer", escapeHtml(claim.senderName)],
  ["Amount they sent", `${formatNaira(claim.amountKobo)}${short ? ` <span style="color:#b91c1c;">(expected ${formatNaira(expected)})</span>` : ""}`],
  ["Date paid", escapeHtml(day(claim.paidOn))],
  ["From bank", escapeHtml(claim.bank || "Not given")],
  ["Contact", `${escapeHtml(lead.contactName)}, <a href="tel:${escapeHtml(lead.phone)}" style="color:#c2410c;">${escapeHtml(lead.phone)}</a>`],
])}
${claim.note ? emailCallout(`<strong>Their note:</strong><br>${escapeHtml(claim.note).replace(/\n/g, "<br>")}`) : ""}
${short ? emailCallout("The amount they entered is less than the plan price. Check before approving.", "warn") : ""}
${emailButton(`${siteUrl()}/platform/leads/${lead.id}`, "Check and approve", "navy")}`;

  return sendMail({
    to,
    replyTo: lead.email,
    subject: `[${lead.reference}] Payment sent: ${formatNaira(claim.amountKobo)} from ${lead.companyName}`,
    html: emailShell({
      eyebrow: "Payment to confirm",
      heading: `${lead.companyName} says they've paid`,
      preheader: `${formatNaira(claim.amountKobo)} from ${claim.senderName}. Check your bank, then approve.`,
      body,
      footer: `Reply to this email to reach ${escapeHtml(lead.contactName)} directly.`,
    }),
  });
}

/** To the customer, right after they tap "I've made the payment". */
export async function sendClaimReceived(lead: LeadForEmail, claim: PaymentClaim): Promise<DeliveryResult> {
  const plan = getPlan(lead.plan);
  const body = `
${emailP(`Hello ${first(lead.contactName)},`)}
${emailP(`Thank you. We've received your payment notice for <strong>${escapeHtml(lead.companyName)}</strong> and we're confirming it with our bank now.`)}
${emailTable([
  ["Reference", `<span style="font-family:monospace;">${escapeHtml(lead.reference)}</span>`],
  ["Plan", `${escapeHtml(plan.name)}, 12 months`],
  ["Amount", formatNaira(claim.amountKobo)],
  ["Name on transfer", escapeHtml(claim.senderName)],
])}
${emailCallout("As soon as it's confirmed, we'll email your main admin login so you can start setting up your shop. Usually within a few hours on a working day.", "good")}
${emailP("If you have your transfer receipt, you can reply to this email with it. It helps us confirm faster.", { muted: true, size: 13.5 })}`;

  return sendMail({
    to: lead.email,
    replyTo: salesInbox() ?? undefined,
    subject: `We're confirming your payment (${lead.reference})`,
    html: emailShell({
      eyebrow: `Plan request ${lead.reference}`,
      heading: "Payment notice received",
      preheader: "We're confirming your transfer. Your login follows soon.",
      body,
      footer: `Quote <strong>${escapeHtml(lead.reference)}</strong> on any reply.`,
    }),
  });
}
