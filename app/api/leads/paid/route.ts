import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError, handle, readJson } from "@/lib/api";
import { prisma } from "@/lib/db";
import { sendClaimReceived, sendPaymentClaimAlert } from "@/lib/leadEmails";
import { toKobo } from "@/lib/money";
import { checkPayToken } from "@/lib/payment";
import { clientIp, rateLimit } from "@/lib/rateLimit";

/**
 * POST /api/leads/paid: the customer tells us they've paid.
 *
 * Public, but only works with the private token from their own email. It
 * records what they say and alerts you; it never activates anything. You check
 * the bank, then approve in the console.
 */

const Body = z.object({
  reference: z.string().trim().max(40),
  token: z.string().trim().max(80),
  senderName: z.string().trim().min(2, "Enter the name the transfer came from.").max(120),
  amount: z.string().trim().min(1, "Enter the amount you sent.").max(40),
  paidOn: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date you paid."),
  bank: z.string().trim().max(80).optional().transform((v) => v || null),
  note: z.string().trim().max(1000).optional().transform((v) => v || null),
});

export async function POST(request: Request) {
  return handle(async () => {
    if (!rateLimit(`lead-paid:${clientIp(request)}`, { limit: 10, windowMs: 10 * 60 * 1000 }).ok) {
      throw new AppError("Too many attempts. Please wait a few minutes.", { status: 429 });
    }
    const input = Body.parse(await readJson(request));

    const lead = await prisma.lead.findUnique({ where: { reference: input.reference } });
    if (!lead || !checkPayToken(lead.id, input.token)) {
      throw new AppError("This payment link isn't valid. Use the button in your email.", { status: 404 });
    }
    if (lead.status === "PROVISIONED") {
      throw new AppError("Your account is already active. Check your email for your login.", { status: 409 });
    }
    if (lead.status === "REJECTED") {
      throw new AppError("This request was closed. Reply to our email and we'll help.", { status: 409 });
    }

    const amountKobo = toKobo(input.amount);
    if (!Number.isFinite(amountKobo) || amountKobo <= 0 || amountKobo > 1_000_000_000) {
      throw new AppError("Enter the amount you sent, e.g. 50000.", { fields: { amount: "Not a valid amount" } });
    }
    const paidOn = new Date(`${input.paidOn}T12:00:00Z`);
    if (paidOn.getTime() > Date.now() + 36 * 60 * 60 * 1000) {
      throw new AppError("The payment date can't be in the future.", { fields: { paidOn: "In the future" } });
    }

    const claim = { senderName: input.senderName, amountKobo, paidOn, bank: input.bank, note: input.note };
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        // A lead you've already marked PAID stays PAID; this just records the details.
        status: lead.status === "PAID" ? "PAID" : "CLAIMED",
        paymentClaimedAt: new Date(),
        paymentSenderName: claim.senderName,
        paymentAmountKobo: claim.amountKobo,
        paymentPaidOn: claim.paidOn,
        paymentBank: claim.bank,
        paymentNote: claim.note,
      },
    });

    // Both emails are best-effort: the notice is saved and shows in the console either way.
    await Promise.allSettled([sendPaymentClaimAlert(lead, claim), sendClaimReceived(lead, claim)]);

    return NextResponse.json({ ok: true });
  });
}
