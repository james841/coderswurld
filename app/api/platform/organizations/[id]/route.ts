import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError, handle, readJson } from "@/lib/api";
import { generateTempPassword, hashPassword, requirePlatformApi } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { emailShell, emailTable, escapeHtml, sendMail } from "@/lib/mail";
import { formatNaira } from "@/lib/money";
import { getPlan, ROLE_SEAT_BUCKET, UNLIMITED, type Role } from "@/lib/constants";

/**
 * PATCH /api/platform/organizations/[id] — the operator's controls over one
 * live business.
 *
 * Every branch here reaches into a paying customer's account, so each one is
 * written to be boring and reversible, and each one leaves a row in that
 * customer's own audit log. A business owner who finds their till locked on a
 * Monday morning is entitled to see who did it and when — and if the answer is
 * "the platform", the audit trail should say so rather than leaving them to
 * suspect their own staff.
 *
 * Actions are a discriminated union rather than a patch of loose fields.
 * "Suspend this account" and "change the plan" have almost nothing in common
 * except the URL, and pretending otherwise produces a handler where every field
 * is optional and no combination is validated.
 */

const ActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ACTIVATE") }),
  z.object({
    action: z.literal("SUSPEND"),
    reason: z.string().trim().max(240).optional(),
  }),
  z.object({
    action: z.literal("RENEW"),
    plan: z.enum(["STARTER", "BUSINESS", "ENTERPRISE"]).optional(),
    durationMonths: z.coerce.number().int().min(1).max(120).default(12),
    amountKobo: z.coerce.number().int().min(0).max(1_000_000_000).optional(),
    amountPaidKobo: z.coerce.number().int().min(0).max(1_000_000_000).optional(),
    paymentMethod: z.enum(["BANK_TRANSFER", "CASH", "CARD", "OTHER"]).default("BANK_TRANSFER"),
    paymentReference: z.string().trim().max(120).optional(),
    notes: z.string().trim().max(2000).optional(),
  }),
  z.object({
    action: z.literal("SET_PLAN"),
    plan: z.enum(["STARTER", "BUSINESS", "ENTERPRISE"]),
  }),
  z.object({
    action: z.literal("RESET_ADMIN_PASSWORD"),
    userId: z.string().trim().min(1).max(40),
  }),
  z.object({
    action: z.literal("UPDATE_CONTACT"),
    name: z.string().trim().min(2).max(160).optional(),
    email: z.string().trim().toLowerCase().email().max(160).optional(),
    phone: z.string().trim().min(7).max(40).optional(),
    whatsapp: z.string().trim().max(40).optional(),
    address: z.string().trim().max(240).optional(),
    city: z.string().trim().max(80).optional(),
    state: z.string().trim().max(80).optional(),
  }),
]);

export async function PATCH(
  request: Request,
  context: RouteContext<"/api/platform/organizations/[id]">,
) {
  return handle(async () => {
    const session = await requirePlatformApi();
    const { id } = await context.params;
    const payload = ActionSchema.parse(await readJson(request));

    const organization = await prisma.organization.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        status: true,
        plan: true,
        email: true,
        activatedAt: true,
      },
    });
    if (!organization) {
      throw new AppError("That business no longer exists.", { status: 404 });
    }

    /** Every action logs into the tenant's own trail. Never allowed to fail the action. */
    const audit = (action: string, summary: string) =>
      prisma.auditLog
        .create({
          data: {
            organizationId: organization.id,
            userName: `Platform · ${session.name}`,
            action,
            entity: "Organization",
            entityId: organization.id,
            summary,
          },
        })
        .catch((error) => {
          console.error("[platform/organizations] audit write failed:", error);
        });

    switch (payload.action) {
      // ── Turn the lights on ───────────────────────────────────────────────
      case "ACTIVATE": {
        const subscription = await prisma.subscription.findFirst({
          where: { organizationId: organization.id },
          orderBy: { expiresAt: "desc" },
          select: { id: true, expiresAt: true, status: true },
        });

        // Activating an account whose subscription already lapsed just puts it
        // straight back into EXPIRED on the next request, which looks like the
        // button is broken. Say what's actually needed instead.
        if (subscription && subscription.expiresAt.getTime() < Date.now()) {
          throw new AppError(
            `${organization.name}'s subscription expired on ${subscription.expiresAt.toISOString().slice(0, 10)}. Record a renewal instead — that activates them too.`,
            { status: 409 },
          );
        }

        await prisma.organization.update({
          where: { id: organization.id },
          data: {
            status: "ACTIVE",
            suspendedAt: null,
            activatedAt: organization.activatedAt ?? new Date(),
          },
        });
        await audit("ORG_ACTIVATED", "Account activated by the platform.");
        return NextResponse.json({ ok: true, status: "ACTIVE" });
      }

      // ── Turn them off ────────────────────────────────────────────────────
      case "SUSPEND": {
        await prisma.organization.update({
          where: { id: organization.id },
          data: { status: "SUSPENDED", suspendedAt: new Date() },
        });
        await audit(
          "ORG_SUSPENDED",
          payload.reason
            ? `Account suspended by the platform: ${payload.reason}`
            : "Account suspended by the platform.",
        );
        return NextResponse.json({ ok: true, status: "SUSPENDED" });
      }

      // ── Take another year's money ────────────────────────────────────────
      case "RENEW": {
        const current = await prisma.subscription.findFirst({
          where: { organizationId: organization.id },
          orderBy: { expiresAt: "desc" },
          select: { id: true, expiresAt: true, plan: true, status: true },
        });

        const plan = getPlan(payload.plan ?? current?.plan ?? organization.plan);
        const amountKobo = payload.amountKobo ?? plan.priceKobo;

        // Renewing early must not cost the customer the days they already paid
        // for. Start the new term where the old one ends, unless it has already
        // lapsed — then start today.
        const now = new Date();
        const startsAt =
          current && current.expiresAt.getTime() > now.getTime() ? current.expiresAt : now;
        const expiresAt = new Date(startsAt);
        expiresAt.setMonth(expiresAt.getMonth() + payload.durationMonths);

        await prisma.$transaction(async (tx) => {
          // The old row is closed, not overwritten. Payment history is the one
          // thing a customer will argue about, and a single mutable row cannot
          // answer "what did I pay last March".
          if (current && current.status === "ACTIVE") {
            await tx.subscription.update({
              where: { id: current.id },
              data: { status: "EXPIRED" },
            });
          }

          await tx.subscription.create({
            data: {
              organizationId: organization.id,
              plan: plan.id,
              amountKobo,
              billingCycle: payload.durationMonths >= 24 ? "BIENNIAL" : "YEARLY",
              startsAt,
              expiresAt,
              status: "ACTIVE",
              paymentMethod: payload.paymentMethod,
              paymentReference: payload.paymentReference ?? null,
              paidAt: now,
              amountPaidKobo: payload.amountPaidKobo ?? amountKobo,
              seatsMainAdmin: plan.seats.mainAdmin,
              seatsSubAdmin: plan.seats.subAdmin,
              seatsCashier: plan.seats.cashier,
              maxBranches: plan.seats.branches,
              notes: payload.notes ?? null,
              recordedByAdminId: session.id,
            },
          });

          await tx.organization.update({
            where: { id: organization.id },
            data: {
              plan: plan.id,
              status: "ACTIVE",
              suspendedAt: null,
              activatedAt: organization.activatedAt ?? now,
            },
          });
        });

        await audit(
          "SUBSCRIPTION_RENEWED",
          `${plan.name} plan renewed for ${payload.durationMonths} months — ${formatNaira(amountKobo)}, valid to ${expiresAt.toISOString().slice(0, 10)}.`,
        );

        await sendRenewalReceipt({
          to: organization.email,
          organizationName: organization.name,
          planName: plan.name,
          amountKobo: payload.amountPaidKobo ?? amountKobo,
          expiresAt,
        }).catch((error) => {
          console.error("[platform/organizations] renewal receipt failed:", error);
        });

        return NextResponse.json({
          ok: true,
          plan: plan.id,
          expiresAt: expiresAt.toISOString(),
        });
      }

      // ── Move them up or down a tier ──────────────────────────────────────
      case "SET_PLAN": {
        const plan = getPlan(payload.plan);

        // A downgrade that leaves the business over its seat limit is worse than
        // refusing it: the extra staff keep working until someone tries to edit
        // one, and then a form fails with an error the owner can't act on.
        const [users, branches] = await Promise.all([
          prisma.user.groupBy({
            by: ["role"],
            where: { organizationId: organization.id, isActive: true },
            _count: { _all: true },
          }),
          prisma.branch.count({ where: { organizationId: organization.id, isActive: true } }),
        ]);

        const over: string[] = [];
        for (const row of users) {
          const bucket = ROLE_SEAT_BUCKET[row.role as Role];
          if (!bucket) continue;
          const limit = plan.seats[bucket];
          if (limit !== UNLIMITED && row._count._all > limit) {
            over.push(`${row._count._all} ${bucket.replace(/([A-Z])/g, " $1").toLowerCase()}s (limit ${limit})`);
          }
        }
        if (plan.seats.branches !== UNLIMITED && branches > plan.seats.branches) {
          over.push(`${branches} shops (limit ${plan.seats.branches})`);
        }

        if (over.length > 0) {
          throw new AppError(
            `${organization.name} has ${over.join(", ")}. Deactivate the extras first, or they'll be locked out mid-shift.`,
            { status: 409 },
          );
        }

        const current = await prisma.subscription.findFirst({
          where: { organizationId: organization.id, status: "ACTIVE" },
          orderBy: { expiresAt: "desc" },
          select: { id: true },
        });

        await prisma.$transaction(async (tx) => {
          await tx.organization.update({
            where: { id: organization.id },
            data: { plan: plan.id },
          });
          if (current) {
            await tx.subscription.update({
              where: { id: current.id },
              data: {
                plan: plan.id,
                seatsMainAdmin: plan.seats.mainAdmin,
                seatsSubAdmin: plan.seats.subAdmin,
                seatsCashier: plan.seats.cashier,
                maxBranches: plan.seats.branches,
              },
            });
          }
        });

        await audit(
          "PLAN_CHANGED",
          `Plan changed from ${organization.plan} to ${plan.id} by the platform.`,
        );
        return NextResponse.json({ ok: true, plan: plan.id });
      }

      // ── "I can't log in" ─────────────────────────────────────────────────
      case "RESET_ADMIN_PASSWORD": {
        const user = await prisma.user.findFirst({
          where: { id: payload.userId, organizationId: organization.id },
          select: { id: true, name: true, email: true, role: true },
        });
        if (!user) throw new AppError("That user is not in this business.", { status: 404 });

        // Cashier PINs are reset by their own admin, who knows which of their
        // staff is standing at the till. The platform has no business in there.
        if (user.role !== "MAIN_ADMIN" && user.role !== "SUB_ADMIN") {
          throw new AppError(
            "Only admin logins can be reset from here. A cashier's PIN is reset by their own main admin.",
            { status: 403 },
          );
        }

        const tempPassword = generateTempPassword();
        await prisma.user.update({
          where: { id: user.id },
          data: {
            passwordHash: await hashPassword(tempPassword),
            mustChangePassword: true,
          },
        });

        await audit(
          "PASSWORD_RESET",
          `Password reset for ${user.name}${user.email ? ` (${user.email})` : ""} by the platform.`,
        );

        // `sendMail` reports failure by returning `delivered: false` rather than
        // throwing — an unconfigured SMTP host logs to the console and counts as
        // undelivered. Reporting "email sent" in that case would leave the
        // operator waiting for a reply to a mail nobody received.
        // No email on file: the operator passes the temporary password on by hand.
        const delivered = !user.email ? false : await sendPasswordReset({
          to: user.email,
          name: user.name,
          organizationName: organization.name,
          tempPassword,
        }).catch((error) => {
          console.error("[platform/organizations] reset email failed:", error);
          return false;
        });

        return NextResponse.json({
          ok: true,
          /** Plaintext, returned once. Never stored, never logged. */
          tempPassword,
          email: user.email,
          emailDelivered: delivered,
        });
      }

      // ── Fix a typo in their details ──────────────────────────────────────
      case "UPDATE_CONTACT": {
        const { action: _action, ...fields } = payload;
        const data = Object.fromEntries(
          Object.entries(fields).filter(([, value]) => value !== undefined && value !== ""),
        );
        if (Object.keys(data).length === 0) {
          return NextResponse.json({ ok: true });
        }
        await prisma.organization.update({ where: { id: organization.id }, data });
        await audit(
          "ORG_DETAILS_UPDATED",
          `Business details updated by the platform: ${Object.keys(data).join(", ")}.`,
        );
        return NextResponse.json({ ok: true });
      }
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────

async function sendRenewalReceipt(params: {
  to: string;
  organizationName: string;
  planName: string;
  amountKobo: number;
  expiresAt: Date;
}) {
  const expires = params.expiresAt.toLocaleDateString("en-NG", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  await sendMail({
    to: params.to,
    subject: `Payment received — ${params.organizationName} is active until ${expires}`,
    html: emailShell({
      heading: "Payment received",
      preheader: `${params.planName} plan active until ${expires}.`,
      body: `
<p style="margin:0 0 16px;">Thank you. We've received your payment and <strong>${escapeHtml(params.organizationName)}</strong> is active.</p>
${emailTable([
  ["Plan", escapeHtml(params.planName)],
  ["Amount received", formatNaira(params.amountKobo)],
  ["Active until", escapeHtml(expires)],
])}
<p style="margin:0 0 16px;">Nothing changes at your end — your staff can keep working and your data is exactly where it was.</p>
<p style="margin:0;">&mdash; The Coderswurld team</p>`,
      footer: "Keep this email as your receipt.",
    }),
  });
}

async function sendPasswordReset(params: {
  to: string;
  name: string;
  organizationName: string;
  tempPassword: string;
}): Promise<boolean> {
  const result = await sendMail({
    to: params.to,
    subject: `Your temporary password — ${params.organizationName}`,
    html: emailShell({
      heading: "Temporary password",
      preheader: "Sign in with this, then set your own.",
      body: `
<p style="margin:0 0 16px;">Hello ${escapeHtml(params.name.split(" ")[0])},</p>
<p style="margin:0 0 16px;">We've reset the password for your <strong>${escapeHtml(params.organizationName)}</strong> login at your request.</p>
${emailTable([
  ["Email", escapeHtml(params.to)],
  [
    "Temporary password",
    `<span style="font-family:monospace;font-size:17px;font-weight:700;letter-spacing:1px;">${escapeHtml(params.tempPassword)}</span>`,
  ],
])}
<p style="margin:0 0 16px;">You'll be asked to choose your own password the moment you sign in. If you didn't ask for this, tell us immediately — someone else may be trying to get into your account.</p>
<p style="margin:0;">&mdash; The Coderswurld team</p>`,
      footer: "This password only works until you set your own.",
    }),
  });

  return result.delivered;
}
