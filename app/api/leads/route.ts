import { NextResponse } from "next/server";
import { z } from "zod";

import { handle, readJson } from "@/lib/api";
import { prisma } from "@/lib/db";
import { sendNewRequestAlert, sendPaymentInstructions } from "@/lib/leadEmails";
import { paymentDetails } from "@/lib/payment";
import { nextLeadReference } from "@/lib/sequence";
import {
  BUSINESS_TYPES,
  NIGERIAN_STATES,
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

    // ── Emails. Never allowed to fail the request. ────────────────────────
    // With bank details set, the customer gets them straight away and the
    // request moves to Invoiced, so you're not the bottleneck at 2am.
    const forEmail = {
      ...payload,
      id: lead.id,
      reference: lead.reference,
      plan: plan.id,
      quotedKobo: plan.priceKobo,
      notes: nullIfBlank(payload.notes),
    };
    const [toCustomer] = await Promise.allSettled([
      sendPaymentInstructions(forEmail),
      sendNewRequestAlert(forEmail),
    ]);
    if (paymentDetails() && toCustomer.status === "fulfilled" && toCustomer.value.delivered) {
      await prisma.lead
        .update({ where: { id: lead.id }, data: { status: "INVOICED", invoicedAt: new Date() } })
        .catch(() => undefined);
    }

    return NextResponse.json({ ok: true, reference: lead.reference });
  });
}
