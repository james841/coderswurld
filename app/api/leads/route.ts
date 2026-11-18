import { NextResponse } from "next/server";
import { z } from "zod";

import { handle, readJson } from "@/lib/api";
import { prisma } from "@/lib/db";
import { emailShell, emailTable, escapeHtml, sendMail } from "@/lib/mail";
import { nextLeadReference } from "@/lib/sequence";
import { formatNaira } from "@/lib/money";
import {
  BUSINESS_TYPES,
  BUSINESS_TYPE_LABELS,
  NIGERIAN_STATES,
  PLANS,
  getPlan,
} from "@/lib/constants";

/**
 * POST /api/leads — a plan request from the public landing page.
 *
 * This is the front door of the business. It does three things, in this order
 * of importance:
 *
 *   1. Persists the lead. This must not fail.
 *   2. Emails the platform operator so it lands in their inbox.
 *   3. Emails the prospect a confirmation with their reference.
 *
 * Steps 2 and 3 are fire-and-forget *after* the write commits. If SMTP is down
 * or unconfigured, the lead is still safely in the database and visible in the
 * platform dashboard — losing a paying customer's details because a mail server
 * hiccuped would be indefensible.
 */

const LeadSchema = z.object({
  companyName: z.string().trim().min(2, "Please enter your business name.").max(160),
  businessType: z.enum(BUSINESS_TYPES).default("SUPERMARKET"),
  contactName: z.string().trim().min(2, "Please enter your name.").max(120),
  contactRole: z.string().trim().max(80).optional().or(z.literal("")),
  email: z.string().trim().toLowerCase().email("Please enter a valid email address.").max(160),
  phone: z
    .string()
    .trim()
    .min(7, "Please enter a phone number we can reach you on.")
    .max(40),
  whatsapp: z.string().trim().max(40).optional().or(z.literal("")),
  state: z.enum(NIGERIAN_STATES).optional(),
  city: z.string().trim().max(80).optional().or(z.literal("")),
  address: z.string().trim().max(240).optional().or(z.literal("")),
  // The form posts these as strings; coerce rather than reject.
  branchCount: z.coerce.number().int().min(1).max(500).default(1),
  staffCount: z.coerce.number().int().min(1).max(5000).default(1),
  skuEstimate: z.coerce.number().int().min(0).max(1_000_000).default(0),
  plan: z.enum(["STARTER", "BUSINESS", "ENTERPRISE"]).default("STARTER"),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
  // From the site's own visit tracking: where this visitor first came from.
  trafficSource: z.string().trim().max(100).optional().nullable(),
  visitorId: z.string().regex(/^[a-zA-Z0-9_-]{8,64}$/).optional().nullable(),
});

/** Blank optional strings should be NULL in the database, not "". */
function nullIfBlank(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function POST(request: Request) {
  return handle(async () => {
    const payload = LeadSchema.parse(await readJson(request));
    const plan = getPlan(payload.plan);

    // Light abuse guard: the same address submitting repeatedly within a few
    // minutes is a double-click or a bot, not three separate businesses.
    const recent = await prisma.lead.findFirst({
      where: {
        email: payload.email,
        createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) },
      },
      select: { reference: true },
    });
    if (recent) {
      // Idempotent by design: return the existing reference so a double-click
      // shows success rather than a confusing error.
      return NextResponse.json({ ok: true, reference: recent.reference });
    }

    const reference = await nextLeadReference();

    const lead = await prisma.lead.create({
      data: {
        reference,
        companyName: payload.companyName,
        businessType: payload.businessType,
        contactName: payload.contactName,
        contactRole: nullIfBlank(payload.contactRole),
        email: payload.email,
        phone: payload.phone,
        whatsapp: nullIfBlank(payload.whatsapp) ?? payload.phone,
        state: payload.state ?? null,
        city: nullIfBlank(payload.city),
        address: nullIfBlank(payload.address),
        branchCount: payload.branchCount,
        staffCount: payload.staffCount,
        skuEstimate: payload.skuEstimate,
        plan: plan.id,
        billingCycle: "YEARLY",
        quotedKobo: plan.priceKobo,
        notes: nullIfBlank(payload.notes),
        status: "NEW",
        source: "LANDING_PAGE",
        trafficSource: payload.trafficSource || null,
        visitorId: payload.visitorId || null,
        // Behind a proxy the real client is in x-forwarded-for; the first entry
        // is the client, the rest are proxies.
        ipAddress:
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
          request.headers.get("x-real-ip"),
        userAgent: request.headers.get("user-agent")?.slice(0, 500) ?? null,
      },
      select: { id: true, reference: true },
    });

    // ── Notifications. Never allowed to fail the request. ───────────────────
    await Promise.allSettled([
      notifyOperator({ ...payload, reference: lead.reference, planName: plan.name, planPriceKobo: plan.priceKobo }),
      confirmToProspect({ ...payload, reference: lead.reference, planName: plan.name, planPriceKobo: plan.priceKobo }),
    ]);

    return NextResponse.json({ ok: true, reference: lead.reference });
  });
}

// ─────────────────────────────────────────────────────────────────────────────

type NotificationPayload = z.infer<typeof LeadSchema> & {
  reference: string;
  planName: string;
  planPriceKobo: number;
};

async function notifyOperator(lead: NotificationPayload) {
  const to =
    process.env.SALES_NOTIFICATION_EMAIL?.trim() ||
    process.env.PLATFORM_ADMIN_EMAIL?.trim();
  if (!to) return;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const body = `
<p style="margin:0 0 16px;">A business has requested the <strong>${escapeHtml(lead.planName)}</strong> plan.</p>
${emailTable([
  ["Reference", `<span style="font-family:monospace;">${escapeHtml(lead.reference)}</span>`],
  ["Business", escapeHtml(lead.companyName)],
  ["Type", escapeHtml(BUSINESS_TYPE_LABELS[lead.businessType] ?? lead.businessType)],
  ["Plan", `${escapeHtml(lead.planName)} — ${formatNaira(lead.planPriceKobo)}/year`],
  ["Contact", `${escapeHtml(lead.contactName)}${lead.contactRole ? ` (${escapeHtml(lead.contactRole)})` : ""}`],
  ["Email", `<a href="mailto:${escapeHtml(lead.email)}" style="color:#c2410c;">${escapeHtml(lead.email)}</a>`],
  ["Phone", `<a href="tel:${escapeHtml(lead.phone)}" style="color:#c2410c;">${escapeHtml(lead.phone)}</a>`],
  ["Location", escapeHtml([lead.city, lead.state].filter(Boolean).join(", ") || "—")],
  ["Size", `${lead.branchCount} branch${lead.branchCount === 1 ? "" : "es"}, ${lead.staffCount} staff`],
])}
${
  lead.notes
    ? `<p style="margin:0 0 6px;font-size:12px;color:#6a6a6a;">Their note</p>
<p style="margin:0 0 16px;padding:12px;background:#f7f7f8;border-left:3px solid #c2410c;border-radius:0 6px 6px 0;white-space:pre-wrap;">${escapeHtml(lead.notes)}</p>`
    : ""
}
<p style="margin:16px 0 0;">
  <a href="${escapeHtml(appUrl)}/platform/leads" style="display:inline-block;padding:11px 20px;background:#c2410c;border-radius:8px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">Open in dashboard</a>
</p>`;

  await sendMail({
    to,
    // The reference in the subject keeps the whole thread threaded in Gmail.
    subject: `[${lead.reference}] ${lead.planName} plan request — ${lead.companyName}`,
    replyTo: lead.email,
    html: emailShell({
      heading: `New ${lead.planName} plan request`,
      preheader: `${lead.companyName} — ${formatNaira(lead.planPriceKobo)}/year`,
      body,
      footer: `Reply to this email to reach ${escapeHtml(lead.contactName)} directly.`,
    }),
  });
}

async function confirmToProspect(lead: NotificationPayload) {
  const plan = PLANS[lead.plan];

  const body = `
<p style="margin:0 0 16px;">Hello ${escapeHtml(lead.contactName.split(" ")[0])},</p>
<p style="margin:0 0 16px;">Thank you for choosing Coderswurld Inventory for <strong>${escapeHtml(lead.companyName)}</strong>. We have your request and we're preparing your invoice now.</p>
${emailTable([
  ["Your reference", `<span style="font-family:monospace;">${escapeHtml(lead.reference)}</span>`],
  ["Plan", escapeHtml(plan.name)],
  ["Amount", `${formatNaira(plan.priceKobo)} for one year`],
])}
<p style="margin:0 0 8px;font-weight:600;color:#0a0a0a;">What happens next</p>
<ol style="margin:0 0 16px;padding-left:20px;">
  <li style="margin-bottom:6px;">We reply to this email with our bank details and the total.</li>
  <li style="margin-bottom:6px;">You make one transfer for the year.</li>
  <li style="margin-bottom:6px;">We activate your account and send your main admin login — usually the same day.</li>
</ol>
<p style="margin:0 0 16px;">There is nothing to pay yet and we never ask for card details. If anything in your request needs changing, just reply to this email and quote <strong>${escapeHtml(lead.reference)}</strong>.</p>
<p style="margin:0;">&mdash; The Coderswurld team</p>`;

  await sendMail({
    to: lead.email,
    subject: `Your ${plan.name} plan request — ${lead.reference}`,
    html: emailShell({
      heading: "We've got your request",
      preheader: `Reference ${lead.reference}. We'll send your invoice shortly.`,
      body,
      footer: "You're receiving this because you requested a plan at Coderswurld Inventory.",
    }),
  });
}
