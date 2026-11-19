import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError, handle, readJson } from "@/lib/api";
import { requirePlatformApi } from "@/lib/auth";
import { emailP, emailShell, emailSetup, explainMailError, sendMail } from "@/lib/mail";

const Body = z.object({ to: z.string().trim().email("Enter a valid email address.") });

/** Send one test email through the real setup and report exactly what happened. */
export async function POST(request: Request) {
  return handle(async () => {
    const session = await requirePlatformApi();
    const parsed = Body.safeParse(await readJson(request));
    if (!parsed.success) {
      throw new AppError("Check the address.", { status: 422, fields: { to: parsed.error.issues[0]?.message ?? "Invalid." } });
    }
    const setup = emailSetup();
    const sentAt = new Date().toLocaleString("en-NG", { timeZone: "Africa/Lagos" });
    const result = await sendMail({
      to: parsed.data.to,
      subject: "Test email from Coderswurld Inventory",
      html: emailShell({
        eyebrow: "Email check",
        heading: "Your emails are working",
        preheader: "If you can read this, Resend is set up correctly.",
        body:
          emailP(`Hello ${session.name || "there"},`) +
          emailP("This is a test from your platform console. If you can read it, customers will get their payment details, welcome emails and reports.") +
          emailP(`Sent from ${setup.from} at ${sentAt}.`, { muted: true, size: 13 }),
      }),
    });
    return NextResponse.json({
      ok: result.delivered,
      id: result.id ?? null,
      error: result.reason ?? null,
      fix: explainMailError(result.reason),
      from: setup.from,
    });
  });
}
