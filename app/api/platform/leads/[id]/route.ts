import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError, handle, readJson } from "@/lib/api";
import { requirePlatformApi } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { sendPaymentInstructions } from "@/lib/leadEmails";
import { getPlan } from "@/lib/constants";

/**
 * PATCH /api/platform/leads/[id] — move a request along the pipeline.
 *
 * The pipeline is deliberately not enforced as a strict state machine. Real
 * sales do not run in a straight line: a prospect pays before you remembered to
 * mark the invoice sent, someone marked the wrong row, a rejected lead comes
 * back three months later. Forcing NEW → CONTACTED → INVOICED → PAID in order
 * would mean the operator's only way out is editing the database by hand.
 *
 * The one transition that IS guarded is PROVISIONED, because that one is set by
 * `provisionOrganization()` inside a transaction and means "an organization
 * exists for this lead". Letting it be set or cleared by hand would leave the
 * console claiming a business is live when nothing was created.
 */

const PatchSchema = z.object({
  status: z.enum(["NEW", "CONTACTED", "INVOICED", "CLAIMED", "PAID", "REJECTED"]).optional(),
  notes: z.string().trim().max(4000).optional(),
  /** Override the quoted amount — discounts and multi-year deals get negotiated. */
  quotedKobo: z.coerce.number().int().min(0).max(1_000_000_000).optional(),
  plan: z.enum(["STARTER", "BUSINESS", "ENTERPRISE"]).optional(),
  /** Send the prospect the "here's how to pay" email as part of marking INVOICED. */
  sendInvoiceEmail: z.boolean().optional(),
});

export async function PATCH(request: Request, context: RouteContext<"/api/platform/leads/[id]">) {
  return handle(async () => {
    await requirePlatformApi();
    const { id } = await context.params;
    const payload = PatchSchema.parse(await readJson(request));

    const lead = await prisma.lead.findUnique({
      where: { id },
      select: {
        id: true,
        reference: true,
        status: true,
        companyName: true,
        contactName: true,
        email: true,
        plan: true,
        quotedKobo: true,
      },
    });
    if (!lead) throw new AppError("That request no longer exists.", { status: 404 });

    if (lead.status === "PROVISIONED") {
      throw new AppError(
        "This business is already live. Manage it from the Businesses screen instead.",
        { status: 409 },
      );
    }

    const data: {
      status?: string;
      notes?: string;
      plan?: string;
      quotedKobo?: number;
      invoicedAt?: Date;
      paidAt?: Date | null;
      rejectedAt?: Date | null;
    } = {};

    if (payload.notes !== undefined) data.notes = payload.notes;
    if (payload.plan !== undefined) {
      data.plan = payload.plan;
      // Changing plan without a new quote leaves a contradiction on screen:
      // "Enterprise — ₦50,000". Re-quote from the price book unless the operator
      // passed an explicit override in the same request.
      if (payload.quotedKobo === undefined) data.quotedKobo = getPlan(payload.plan).priceKobo;
    }
    if (payload.quotedKobo !== undefined) data.quotedKobo = payload.quotedKobo;

    if (payload.status !== undefined && payload.status !== lead.status) {
      data.status = payload.status;
      // Stamp the timestamp for the status being *entered*, and clear the ones
      // that no longer apply, so moving a lead back doesn't leave a paidAt on a
      // lead that hasn't paid.
      if (payload.status === "INVOICED") data.invoicedAt = new Date();
      if (payload.status === "PAID") data.paidAt = new Date();
      if (payload.status === "REJECTED") data.rejectedAt = new Date();
      if (payload.status !== "PAID") data.paidAt = null;
      if (payload.status !== "REJECTED") data.rejectedAt = null;
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ ok: true, lead: { id: lead.id, status: lead.status } });
    }

    const updated = await prisma.lead.update({
      where: { id },
      data,
      select: {
        id: true,
        status: true,
        plan: true,
        quotedKobo: true,
        notes: true,
        invoicedAt: true,
        paidAt: true,
        rejectedAt: true,
      },
    });

    // Fire-and-forget, after the write. A mail failure must not roll back a
    // status the operator can see they clicked.
    let emailed: boolean | undefined;
    let emailError: string | undefined;
    if (payload.sendInvoiceEmail && updated.status === "INVOICED") {
      const full = await prisma.lead.findUnique({ where: { id } });
      if (full) {
        const result = await sendPaymentInstructions({ ...full, plan: updated.plan, quotedKobo: updated.quotedKobo }).catch(
          (error: unknown) => ({ delivered: false, reason: error instanceof Error ? error.message : "Email failed" }),
        );
        emailed = result.delivered;
        if (!result.delivered) emailError = "reason" in result ? result.reason : undefined;
      }
    }

    // Tell the console whether the email really went, rather than assuming.
    return NextResponse.json({ ok: true, lead: updated, emailed, emailError });
  });
}
