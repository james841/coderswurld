import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError, handle, readJson } from "@/lib/api";
import { requirePlatformApi } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { provisionOrganization } from "@/lib/provision";
import { BUSINESS_TYPES, NIGERIAN_STATES } from "@/lib/constants";

/**
 * POST /api/platform/organizations — bring a business online.
 *
 * This is the single most consequential call in the platform. It creates the
 * organization, its first branch, its subscription and its main admin, in one
 * transaction (see `lib/provision.ts`), and returns a temporary password that
 * exists in exactly one place for exactly one response: this body. It is never
 * stored in plaintext and never logged, so if the operator closes the page
 * before reading it, the recovery path is "reset the main admin's password",
 * not "look it up".
 *
 * Callable with or without a lead. Most businesses arrive through the landing
 * page, but a walk-in signed up over the phone should not require the operator
 * to first fake a lead for themselves.
 */

const ProvisionSchema = z.object({
  leadId: z.string().trim().max(40).optional(),

  organizationName: z.string().trim().min(2, "Enter the business name.").max(160),
  businessType: z.enum(BUSINESS_TYPES).default("SUPERMARKET"),
  email: z.string().trim().toLowerCase().email("Enter a valid business email.").max(160),
  phone: z.string().trim().min(7, "Enter a phone number.").max(40),
  whatsapp: z.string().trim().max(40).optional().or(z.literal("")),
  state: z.enum(NIGERIAN_STATES).optional().or(z.literal("")),
  city: z.string().trim().max(80).optional().or(z.literal("")),
  address: z.string().trim().max(240).optional().or(z.literal("")),

  plan: z.enum(["STARTER", "BUSINESS", "ENTERPRISE"]),
  /** Naira, as typed. Converted to kobo below. Blank means "use the list price". */
  amountKobo: z.coerce.number().int().min(0).max(1_000_000_000).optional(),
  amountPaidKobo: z.coerce.number().int().min(0).max(1_000_000_000).optional(),
  durationMonths: z.coerce.number().int().min(1).max(120).default(12),
  paymentMethod: z.enum(["BANK_TRANSFER", "CASH", "CARD", "OTHER"]).default("BANK_TRANSFER"),
  paymentReference: z.string().trim().max(120).optional().or(z.literal("")),

  adminName: z.string().trim().min(2, "Enter the main admin's name.").max(120),
  adminEmail: z
    .string()
    .trim()
    .toLowerCase()
    .email("Enter a valid email for the main admin — it is their login.")
    .max(160),
  adminPhone: z.string().trim().max(40).optional().or(z.literal("")),

  branchName: z.string().trim().max(120).optional().or(z.literal("")),
  branchCode: z.string().trim().max(8).optional().or(z.literal("")),

  /** Create the org but leave it unable to trade. Rare — used when payment is partial. */
  startPending: z.boolean().default(false),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

function blankToNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function POST(request: Request) {
  return handle(async () => {
    const session = await requirePlatformApi();
    const payload = ProvisionSchema.parse(await readJson(request));

    // ── Guard rails, checked before anything is written ──────────────────────
    if (payload.leadId) {
      const lead = await prisma.lead.findUnique({
        where: { id: payload.leadId },
        select: { id: true, status: true, organizationId: true, companyName: true },
      });
      if (!lead) throw new AppError("That request no longer exists.", { status: 404 });
      if (lead.organizationId || lead.status === "PROVISIONED") {
        throw new AppError(
          `${lead.companyName} is already live. Open it from the Businesses screen.`,
          { status: 409 },
        );
      }
    }

    // A main admin's email is their login. Two organizations *may* share one
    // (see the sign-in route's collision handling) but it is almost always a
    // typo or a duplicate provision, so make the operator confirm by changing
    // the address rather than silently creating a second account.
    const existingUser = await prisma.user.findFirst({
      where: { email: payload.adminEmail },
      select: { organization: { select: { name: true } } },
    });
    if (existingUser) {
      throw new AppError(
        `${payload.adminEmail} is already the login for ${existingUser.organization.name}. Use a different address for this business.`,
        { status: 409, fields: { adminEmail: "This email already has an account." } },
      );
    }

    const result = await provisionOrganization({
      organizationName: payload.organizationName,
      businessType: payload.businessType,
      email: payload.email,
      phone: payload.phone,
      whatsapp: blankToNull(payload.whatsapp),
      state: blankToNull(payload.state),
      city: blankToNull(payload.city),
      address: blankToNull(payload.address),

      plan: payload.plan,
      amountKobo: payload.amountKobo,
      amountPaidKobo: payload.amountPaidKobo,
      durationMonths: payload.durationMonths,
      paymentMethod: payload.paymentMethod,
      paymentReference: blankToNull(payload.paymentReference),

      adminName: payload.adminName,
      adminEmail: payload.adminEmail,
      adminPhone: blankToNull(payload.adminPhone),

      branchName: blankToNull(payload.branchName) ?? undefined,
      branchCode: blankToNull(payload.branchCode) ?? undefined,

      leadId: payload.leadId ?? null,
      recordedByAdminId: session.id,
      startPending: payload.startPending,
      notes: blankToNull(payload.notes),
    });

    // Record who did this in the tenant's own audit trail. The business owner
    // is entitled to see that their plan was set by the platform and not by one
    // of their staff.
    await prisma.auditLog
      .create({
        data: {
          organizationId: result.organizationId,
          userName: `Platform · ${session.name}`,
          action: "ORG_PROVISIONED",
          entity: "Organization",
          entityId: result.organizationId,
          summary: `Account created on the ${payload.plan.charAt(0) + payload.plan.slice(1).toLowerCase()} plan, valid until ${result.expiresAt.toISOString().slice(0, 10)}.`,
        },
      })
      .catch((error) => {
        // The org exists and works. An audit row that failed to write is a
        // bookkeeping problem, not a reason to tell the operator it went wrong.
        console.error("[platform/organizations] audit write failed:", error);
      });

    return NextResponse.json(
      {
        ok: true,
        organizationId: result.organizationId,
        slug: result.slug,
        adminEmail: result.adminEmail,
        /** Shown once, on screen. Never retrievable again. */
        tempPassword: result.tempPassword,
        expiresAt: result.expiresAt.toISOString(),
        emailDelivered: result.emailDelivered,
      },
      { status: 201 },
    );
  });
}
