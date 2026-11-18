import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError, handle, readJson } from "@/lib/api";
import { requireTenantApi } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canDesignReceipt, receiptDesignSchema } from "@/lib/receiptDesign";

/**
 * PATCH /api/settings/receipt-design: how the receipt looks.
 *
 * Open to main admins, sub-admins and managers (and anyone allowed to change
 * settings), because the person running the floor is usually the one who
 * wants the shop's phone numbers or Instagram on the slip.
 */

// A logo is kept small and stored inline, so it prints offline too.
const LOGO = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

const Body = z.object({
  receiptWidth: z.enum(["80mm", "58mm"]),
  receiptHeader: z.string().trim().max(200).nullable().transform((v) => v || null),
  receiptFooter: z.string().trim().max(200),
  receiptShowCashier: z.boolean(),
  receiptShowLogo: z.boolean(),
  receiptAutoPrint: z.boolean(),
  design: receiptDesignSchema,
  /** A data URL, null to remove the logo, or undefined to leave it as it is. */
  logo: z
    .string()
    .max(120_000, "That logo is too large. Try a smaller picture.")
    .regex(LOGO, "Use a PNG, JPG or WebP picture.")
    .nullable()
    .optional(),
});

export async function PATCH(request: Request) {
  return handle(async () => {
    const session = await requireTenantApi();
    if (!canDesignReceipt(session.user)) {
      throw new AppError("Only admins and managers can change the receipt.", { status: 403 });
    }
    const input = Body.parse(await readJson(request));
    const orgId = session.org.id;

    await prisma.$transaction(async (tx) => {
      const data = {
        receiptWidth: input.receiptWidth,
        receiptHeader: input.receiptHeader,
        receiptFooter: input.receiptFooter,
        receiptShowCashier: input.receiptShowCashier,
        receiptShowLogo: input.receiptShowLogo,
        receiptAutoPrint: input.receiptAutoPrint,
        receiptDesign: input.design,
      };
      await tx.orgSettings.upsert({
        where: { organizationId: orgId },
        update: data,
        create: { organizationId: orgId, ...data },
      });
      if (input.logo !== undefined) {
        await tx.organization.update({ where: { id: orgId }, data: { logoUrl: input.logo } });
      }
      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          userId: session.user.id,
          userName: session.user.name,
          action: "SETTINGS_CHANGED",
          entity: "OrgSettings",
          entityId: orgId,
          summary: "Changed the receipt design",
        },
      });
    });

    return NextResponse.json({ ok: true });
  });
}
