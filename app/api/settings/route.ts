import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError, handle, readJson } from "@/lib/api";
import { requireTenantApi } from "@/lib/auth";
import { BUSINESS_TYPES, NIGERIAN_STATES, PERMISSIONS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/permissions";

/**
 * Business settings: the profile, the receipt, how the till behaves, alerts,
 * the daily report and tax.
 *
 * One PATCH for all of it, and every field optional — the page saves one
 * section at a time and sends only that section, so two admins editing
 * different sections never overwrite each other's work.
 *
 * Only switches that the product actually obeys are accepted here. A setting
 * that can be turned on but does nothing is worse than no setting: the owner
 * believes they are protected and they are not.
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v || null));

const SettingsSchema = z
  .object({
    // ── Business profile (Organization) ─────────────────────────────────────
    name: z.string().trim().min(2, "Enter the business name.").max(120),
    businessType: z.enum(BUSINESS_TYPES),
    email: z.string().trim().toLowerCase().max(160).email("Enter a valid email address."),
    phone: z.string().trim().min(7, "Enter a phone number.").max(30),
    whatsapp: optionalText(30),
    address: optionalText(240),
    city: optionalText(80),
    state: z
      .string()
      .trim()
      .nullable()
      .transform((v) => v || null)
      .refine((v) => v === null || NIGERIAN_STATES.includes(v), "Choose a state."),

    // ── Departments ─────────────────────────────────────────────────────────
    departmentsEnabled: z.boolean(),

    // ── Receipt ─────────────────────────────────────────────────────────────
    receiptWidth: z.enum(["80mm", "58mm"]),
    receiptHeader: optionalText(200),
    receiptFooter: z.string().trim().max(200),
    receiptShowCashier: z.boolean(),
    receiptAutoPrint: z.boolean(),

    // ── Till ────────────────────────────────────────────────────────────────
    allowNegativeStock: z.boolean(),
    autoWholesale: z.boolean(),
    defaultPriceMode: z.enum(["RETAIL", "WHOLESALE"]),
    requireCustomerForCredit: z.boolean(),

    // ── Alerts ──────────────────────────────────────────────────────────────
    expiryWarningDays: z.coerce
      .number()
      .int("Use a whole number of days.")
      .min(1, "At least 1 day.")
      .max(730, "At most 730 days."),

    // ── Daily report ────────────────────────────────────────────────────────
    dailyReportEnabled: z.boolean(),
    reportChannel: z.enum(["NONE", "EMAIL", "WHATSAPP", "BOTH"]),
    reportEmail: z
      .string()
      .trim()
      .toLowerCase()
      .max(160)
      .nullable()
      .transform((v) => v || null)
      .refine((v) => v === null || z.string().email().safeParse(v).success, "Enter a valid email address."),
    reportWhatsapp: optionalText(30),
    reportTime: z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 21:00."),
    reportToAllAdmins: z.boolean(),

    // ── Tax ─────────────────────────────────────────────────────────────────
    vatEnabled: z.boolean(),
    /** Percent, e.g. 7.5. Stored as basis points so 7.5% is exactly 750. */
    vatPercent: z.coerce.number().min(0, "Can't be negative.").max(50, "That is too high."),
    vatInclusive: z.boolean(),
  })
  .partial();

const ORG_KEYS = ["name", "businessType", "email", "phone", "whatsapp", "address", "city", "state"] as const;

export async function PATCH(request: Request) {
  return handle(async () => {
    const session = await requireTenantApi();
    requirePermission(session.user, PERMISSIONS.SETTINGS_MANAGE);

    const input = SettingsSchema.parse(await readJson(request));

    const orgData: Record<string, unknown> = {};
    const settingsData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (value === undefined) continue;
      if ((ORG_KEYS as readonly string[]).includes(key)) orgData[key] = value;
      else if (key === "vatPercent") settingsData.vatBasisPoints = Math.round((value as number) * 100);
      else settingsData[key] = value;
    }

    const changed = [...Object.keys(orgData), ...Object.keys(settingsData)];
    if (changed.length === 0) throw new AppError("Nothing to save.");

    await prisma.$transaction(async (tx) => {
      if (Object.keys(orgData).length > 0) {
        await tx.organization.update({ where: { id: session.org.id }, data: orgData });
      }
      if (Object.keys(settingsData).length > 0) {
        // Every business gets a settings row when it is created; `upsert` is
        // for the one that somehow didn't, so saving repairs it instead of
        // failing.
        await tx.orgSettings.upsert({
          where: { organizationId: session.org.id },
          update: settingsData,
          create: { organizationId: session.org.id, ...settingsData },
        });
      }
      await tx.auditLog.create({
        data: {
          organizationId: session.org.id,
          userId: session.user.id,
          userName: session.user.name,
          action: "SETTINGS_CHANGED",
          entity: "OrgSettings",
          entityId: session.org.id,
          summary: `Changed settings: ${changed.join(", ")}.`,
        },
      });
    });

    return NextResponse.json({ ok: true });
  });
}
