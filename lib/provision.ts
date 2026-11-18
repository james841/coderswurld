import { toLoginName } from "./loginName";
import "server-only";

import { Prisma } from "@prisma/client";

import { prisma } from "./db";
import { generateTempPassword, hashPassword } from "./auth";
import { uniqueOrgSlug } from "./sequence";
import { getPlan, type PlanId } from "./constants";
import { emailButton, emailShell, emailTable, escapeHtml, sendMail } from "./mail";
import { formatNaira } from "./money";

/**
 * Provisioning — turning a paid lead into a working shop.
 *
 * This is the single most consequential write in the system: it is the moment a
 * customer becomes real. It runs as one transaction, because a half-provisioned
 * organization (an org row with no main admin, say) is worse than a failed
 * provision — nobody can sign in to fix it and the operator has no obvious way
 * to tell it happened.
 *
 * The welcome email is sent *after* the transaction commits, never inside it. A
 * slow mail server must not hold a database transaction open, and an email that
 * fails to send is recoverable (resend it) in a way that a rolled-back org is
 * not.
 */

export interface ProvisionInput {
  organizationName: string;
  businessType: string;
  email: string;
  phone: string;
  whatsapp?: string | null;
  state?: string | null;
  city?: string | null;
  address?: string | null;

  plan: PlanId;
  /** Defaults to the plan's list price. An operator can discount. */
  amountKobo?: number;
  /** Months of access purchased. 12 unless the operator says otherwise. */
  durationMonths?: number;
  paymentMethod?: string | null;
  paymentReference?: string | null;
  amountPaidKobo?: number;

  adminName: string;
  adminEmail: string;
  adminPhone?: string | null;

  branchName?: string;
  /** 2–4 characters; prefixes every receipt number. Derived if omitted. */
  branchCode?: string;

  /** Link this lead to the new organization and mark it PROVISIONED. */
  leadId?: string | null;
  /** The PlatformAdmin doing this, recorded on the subscription. */
  recordedByAdminId?: string | null;
  /** Start locked (PENDING) instead of ACTIVE. Rare — used for trials on hold. */
  startPending?: boolean;
  notes?: string | null;
}

export interface ProvisionResult {
  organizationId: string;
  slug: string;
  adminUserId: string;
  adminEmail: string;
  /** Plaintext, returned exactly once. Never stored, never logged. */
  tempPassword: string;
  expiresAt: Date;
  emailDelivered: boolean;
}

/**
 * A short branch code: "Ikeja" → "IKJ", "Mama Nkechi Supermarket" → "MNS".
 *
 * It ends up on every printed receipt, so it should look like something a human
 * chose. Falls back to consonants, then to padding, and the caller resolves
 * collisions.
 */
export function deriveBranchCode(source: string): string {
  const cleaned = source.replace(/[^a-zA-Z\s]/g, " ").trim();
  const words = cleaned.split(/\s+/).filter(Boolean);

  if (words.length >= 2) {
    const initials = words.slice(0, 3).map((w) => w[0]!.toUpperCase()).join("");
    if (initials.length >= 2) return initials;
  }

  const word = (words[0] ?? "MAIN").toUpperCase();
  // Drop interior vowels: IKEJA → IKJ, SURULERE → SRL.
  const squeezed = word[0] + word.slice(1).replace(/[AEIOU]/g, "");
  const code = (squeezed.length >= 2 ? squeezed : word).slice(0, 3);
  return code.padEnd(2, "X");
}

async function uniqueBranchCode(
  tx: Prisma.TransactionClient,
  organizationId: string,
  desired: string,
): Promise<string> {
  const base = desired.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) || "MAIN";
  for (let attempt = 0; attempt < 30; attempt++) {
    const candidate = attempt === 0 ? base : `${base.slice(0, 3)}${attempt}`;
    const clash = await tx.branch.findFirst({
      where: { organizationId, code: candidate },
      select: { id: true },
    });
    if (!clash) return candidate;
  }
  // Practically unreachable — 30 branches sharing one code stem.
  return `${base.slice(0, 2)}${Date.now().toString().slice(-2)}`;
}

/** A sensible starting shelf layout so the products screen isn't a blank page. */
const STARTER_CATEGORIES = [
  "Provisions",
  "Drinks",
  "Toiletries",
  "Household",
  "Snacks",
  "Frozen",
];

export async function provisionOrganization(
  input: ProvisionInput,
): Promise<ProvisionResult> {
  const plan = getPlan(input.plan);
  const durationMonths = input.durationMonths ?? 12;
  const amountKobo = input.amountKobo ?? plan.priceKobo;

  const slug = await uniqueOrgSlug(input.organizationName);
  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  const startsAt = new Date();
  const expiresAt = new Date(startsAt);
  expiresAt.setMonth(expiresAt.getMonth() + durationMonths);

  const created = await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: {
        name: input.organizationName.trim(),
        slug,
        businessType: input.businessType,
        email: input.email,
        phone: input.phone,
        whatsapp: input.whatsapp?.trim() || input.phone,
        address: input.address?.trim() || null,
        city: input.city?.trim() || null,
        state: input.state?.trim() || null,
        plan: plan.id,
        status: input.startPending ? "PENDING" : "ACTIVE",
        activatedAt: input.startPending ? null : startsAt,
      },
      select: { id: true, slug: true, name: true },
    });

    await tx.orgSettings.create({
      data: {
        organizationId: organization.id,
        reportEmail: input.email,
        reportWhatsapp: input.whatsapp?.trim() || input.phone,
      },
    });

    const code = await uniqueBranchCode(
      tx,
      organization.id,
      input.branchCode?.trim() ||
        deriveBranchCode(input.city?.trim() || input.organizationName),
    );

    const branch = await tx.branch.create({
      data: {
        organizationId: organization.id,
        name: input.branchName?.trim() || "Main Shop",
        code,
        address: input.address?.trim() || null,
        phone: input.phone,
        isMain: true,
      },
      select: { id: true, code: true, name: true },
    });

    await tx.subscription.create({
      data: {
        organizationId: organization.id,
        plan: plan.id,
        amountKobo,
        billingCycle: durationMonths === 12 ? "YEARLY" : durationMonths === 24 ? "BIENNIAL" : "YEARLY",
        startsAt,
        expiresAt,
        status: "ACTIVE",
        paymentMethod: input.paymentMethod ?? "BANK_TRANSFER",
        paymentReference: input.paymentReference ?? null,
        paidAt: startsAt,
        amountPaidKobo: input.amountPaidKobo ?? amountKobo,
        seatsMainAdmin: plan.seats.mainAdmin,
        seatsSubAdmin: plan.seats.subAdmin,
        seatsCashier: plan.seats.cashier,
        maxBranches: plan.seats.branches,
        notes: input.notes ?? null,
        recordedByAdminId: input.recordedByAdminId ?? null,
      },
    });

    const adminUser = await tx.user.create({
      data: {
        organizationId: organization.id,
        branchId: branch.id,
        name: input.adminName.trim(),
        loginName: toLoginName(input.adminName),
        email: input.adminEmail.trim().toLowerCase(),
        phone: input.adminPhone?.trim() || input.phone,
        passwordHash,
        role: "MAIN_ADMIN",
        // Empty list on purpose: MAIN_ADMIN is resolved to every permission in
        // lib/permissions.ts and its stored list is never consulted.
        permissions: "[]",
        mustChangePassword: true,
      },
      select: { id: true, email: true },
    });

    await tx.category.createMany({
      data: STARTER_CATEGORIES.map((name, index) => ({
        organizationId: organization.id,
        name,
        sortOrder: index,
      })),
    });

    if (input.leadId) {
      await tx.lead.update({
        where: { id: input.leadId },
        data: {
          organizationId: organization.id,
          status: "PROVISIONED",
          paidAt: new Date(),
        },
      });
    }

    return { organization, branch, adminUser };
  });

  const delivery = await sendWelcomeEmail({
    organizationName: created.organization.name,
    adminName: input.adminName,
    adminEmail: created.adminUser.email ?? input.adminEmail,
    tempPassword,
    planName: plan.name,
    amountKobo,
    expiresAt,
    branchCode: created.branch.code,
  }).catch((error) => {
    // The org exists and is usable; the operator can resend from the console.
    console.error("[provision] welcome email failed:", error);
    return { delivered: false };
  });

  return {
    organizationId: created.organization.id,
    slug: created.organization.slug,
    adminUserId: created.adminUser.id,
    adminEmail: created.adminUser.email ?? input.adminEmail,
    tempPassword,
    expiresAt,
    emailDelivered: delivery.delivered,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

export async function sendWelcomeEmail(params: {
  organizationName: string;
  adminName: string;
  adminEmail: string;
  tempPassword: string;
  planName: string;
  amountKobo: number;
  expiresAt: Date;
  branchCode: string;
}) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const body = `
<p style="margin:0 0 16px;">Hello ${escapeHtml(params.adminName.split(" ")[0] ?? params.adminName)},</p>
<p style="margin:0 0 16px;"><strong>${escapeHtml(params.organizationName)}</strong> is now live on Coderswurld Inventory. Here are your main admin details.</p>
${emailTable([
  ["Sign in at", `<a href="${escapeHtml(appUrl)}/signin" style="color:#c2410c;">${escapeHtml(appUrl)}/signin</a>`],
  ["Email", `<span style="font-family:monospace;">${escapeHtml(params.adminEmail)}</span>`],
  [
    "Temporary password",
    `<span style="font-family:monospace;font-size:16px;font-weight:700;letter-spacing:0.5px;">${escapeHtml(params.tempPassword)}</span>`,
  ],
  ["Plan", `${escapeHtml(params.planName)} — ${formatNaira(params.amountKobo)}`],
  [
    "Active until",
    params.expiresAt.toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" }),
  ],
  ["Receipt prefix", `<span style="font-family:monospace;">${escapeHtml(params.branchCode)}-000001</span>`],
])}
<p style="margin:0 0 16px;padding:12px;background:#fff4ed;border-left:3px solid #c2410c;border-radius:0 6px 6px 0;font-size:13px;">
  <strong>You'll be asked to change this password the first time you sign in.</strong>
  Please do — and don't forward this email to anyone.
</p>
<p style="margin:0 0 8px;font-weight:600;color:#0a0a0a;">Your first fifteen minutes</p>
<ol style="margin:0 0 20px;padding-left:20px;">
  <li style="margin-bottom:6px;">Add your products — one by one, or import your whole list from Excel.</li>
  <li style="margin-bottom:6px;">Create accounts for your cashiers under <strong>Staff</strong>.</li>
  <li style="margin-bottom:6px;">Open the till and ring up a test sale to check your receipt printer.</li>
</ol>
${emailButton(`${appUrl}/signin`, "Sign in now")}`;

  return sendMail({
    to: params.adminEmail,
    subject: `${params.organizationName} is live — your Coderswurld login`,
    html: emailShell({
      heading: "Your shop is ready",
      preheader: `Sign in details for ${params.organizationName}.`,
      body,
      footer: "Keep this email safe until you've changed your password.",
    }),
  });
}
