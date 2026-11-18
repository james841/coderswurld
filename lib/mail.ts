import "server-only";

/**
 * Outbound email.
 *
 * nodemailer is imported lazily so a page that merely *links* to something
 * email-related doesn't drag a Node-only SMTP client into its module graph.
 *
 * WHEN SMTP IS NOT CONFIGURED the message is logged to the console and reported
 * as `delivered: false` with a reason, instead of throwing. That is deliberate:
 * a shop should still be able to complete a sale and close a day when the
 * owner hasn't set up SMTP yet. Report delivery is a notification, not a
 * prerequisite for trading.
 */

export interface MailMessage {
  to: string | string[];
  subject: string;
  html: string;
  /** Plain-text fallback. Generated from the HTML when omitted. */
  text?: string;
  replyTo?: string;
}

export interface DeliveryResult {
  delivered: boolean;
  channel: "EMAIL" | "WHATSAPP";
  reason?: string;
  id?: string;
}

/** Resend is the main sender. SMTP stays as a fallback for anyone who prefers it. */
function resendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_API_KEY.trim());
}

export function isEmailConfigured(): boolean {
  return resendConfigured() || Boolean(process.env.SMTP_HOST && process.env.SMTP_HOST.trim());
}

function fromAddress(): string {
  return (
    process.env.MAIL_FROM ||
    process.env.SMTP_FROM ||
    process.env.SMTP_USER ||
    "Coderswurld Inventory <onboarding@resend.dev>"
  );
}

/**
 * Send through Resend's HTTP API. A plain fetch instead of the SDK: one less
 * package, and it runs anywhere (Node, serverless, edge) with no SMTP port.
 */
async function sendWithResend(
  to: string[],
  message: MailMessage,
): Promise<DeliveryResult> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromAddress(),
      to,
      subject: message.subject,
      html: message.html,
      text: message.text ?? htmlToText(message.html),
      ...(message.replyTo ? { reply_to: message.replyTo } : {}),
    }),
  });
  const data = (await response.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
  if (!response.ok) {
    // Resend explains itself ("domain is not verified", "invalid API key").
    // Keep its words so the platform console shows the real reason.
    throw new Error(`Resend ${response.status}: ${data.message ?? data.name ?? "request failed"}`);
  }
  return { delivered: true, channel: "EMAIL", id: data.id };
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#8358;/g, "₦")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function sendMail(message: MailMessage): Promise<DeliveryResult> {
  const recipients = Array.isArray(message.to) ? message.to : [message.to];
  const to = recipients.filter((r) => r && r.includes("@")).join(", ");

  if (!to) {
    return { delivered: false, channel: "EMAIL", reason: "No valid recipient address." };
  }

  if (!isEmailConfigured()) {
    console.info(
      [
        "",
        "┌─ EMAIL (not sent: set RESEND_API_KEY in .env) ─────────────────────",
        `│ To:      ${to}`,
        `│ Subject: ${message.subject}`,
        "├────────────────────────────────────────────────────────────────────",
        htmlToText(message.html)
          .split("\n")
          .map((line) => `│ ${line}`)
          .join("\n"),
        "└────────────────────────────────────────────────────────────────────",
        "",
      ].join("\n"),
    );
    return { delivered: false, channel: "EMAIL", reason: "Email is not configured." };
  }

  try {
    if (resendConfigured()) {
      return await sendWithResend(
        recipients.filter((r) => r && r.includes("@")),
        message,
      );
    }

    const nodemailer = (await import("nodemailer")).default;
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
        : undefined,
    });

    const info = await transport.sendMail({
      from: fromAddress(),
      to,
      subject: message.subject,
      html: message.html,
      text: message.text ?? htmlToText(message.html),
      replyTo: message.replyTo,
    });

    return { delivered: true, channel: "EMAIL", id: info.messageId };
  } catch (error) {
    // Logged, not thrown. See the note at the top of this file.
    console.error("[mail] send failed:", error);
    return {
      delivered: false,
      channel: "EMAIL",
      reason: error instanceof Error ? error.message : "Unknown email error.",
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML shell
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wrap body HTML in an email-client-safe shell.
 *
 * Tables and inline styles, not flexbox and classes: Outlook and the Gmail
 * mobile app strip <style> blocks and don't implement modern layout. Colours
 * are hard-coded hex here because CSS variables don't survive an email client.
 */
export function emailShell(options: {
  heading: string;
  preheader?: string;
  body: string;
  footer?: string;
}): string {
  const { heading, preheader, body, footer } = options;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background:#f7f7f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#141414;">
${
  preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>`
    : ""
}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f7f8;padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e9e9e9;border-radius:12px;overflow:hidden;">
      <tr>
        <td style="background:#0a0a0a;padding:18px 24px;">
          <span style="color:#ffffff;font-size:16px;font-weight:700;letter-spacing:-0.2px;">Coderswurld</span><span style="color:#f97316;font-size:16px;font-weight:700;"> Inventory</span>
        </td>
      </tr>
      <tr>
        <td style="padding:28px 24px 8px;">
          <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;font-weight:700;color:#0a0a0a;">${escapeHtml(heading)}</h1>
        </td>
      </tr>
      <tr>
        <td style="padding:0 24px 28px;font-size:14px;line-height:1.6;color:#333333;">
          ${body}
        </td>
      </tr>
      <tr>
        <td style="border-top:1px solid #e9e9e9;padding:16px 24px;font-size:12px;color:#6a6a6a;">
          ${footer ?? "Sent by Coderswurld Inventory."}
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A label/value grid that survives Outlook. */
export function emailTable(rows: Array<[string, string]>): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:4px 0 16px;">
${rows
  .map(
    ([label, value], index) => `  <tr>
    <td style="padding:8px 12px 8px 0;font-size:12px;color:#6a6a6a;white-space:nowrap;vertical-align:top;border-top:${index === 0 ? "none" : "1px solid #f0f0f0"};">${escapeHtml(label)}</td>
    <td style="padding:8px 0;font-size:14px;color:#141414;font-weight:600;vertical-align:top;border-top:${index === 0 ? "none" : "1px solid #f0f0f0"};">${value}</td>
  </tr>`,
  )
  .join("\n")}
</table>`;
}

export function emailButton(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 4px;">
  <tr><td style="background:#c2410c;border-radius:8px;">
    <a href="${escapeHtml(href)}" style="display:inline-block;padding:11px 20px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">${escapeHtml(label)}</a>
  </td></tr>
</table>`;
}
