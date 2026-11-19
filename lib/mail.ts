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

/**
 * Read a setting the way people actually paste it into Vercel or .env: with
 * stray spaces, line breaks or wrapping quotes. A key saved as "re_abc" (quotes
 * included) is sent to Resend with the quotes and fails as an invalid key.
 */
function env(name: string): string {
  return (process.env[name] ?? "").trim().replace(/^(["'])([\s\S]*)\1$/, "$2").trim();
}

/** Values copied from .env.example that were never filled in. */
function isPlaceholder(value: string): boolean {
  return /yourdomain\.com|example\.com/i.test(value);
}

function resendKey(): string {
  return env("RESEND_API_KEY");
}

/** Resend is the main sender. SMTP stays as a fallback for anyone who prefers it. */
function resendConfigured(): boolean {
  return Boolean(resendKey());
}

export function isEmailConfigured(): boolean {
  return resendConfigured() || Boolean(env("SMTP_HOST"));
}

const RESEND_TEST_FROM = "Coderswurld Inventory <onboarding@resend.dev>";

function fromAddress(): string {
  for (const name of ["MAIL_FROM", "SMTP_FROM", "SMTP_USER"]) {
    const value = env(name);
    if (value && !isPlaceholder(value)) return value;
  }
  return RESEND_TEST_FROM;
}

/** The domain part of the From address, e.g. "coderswurld.com". */
function fromDomain(from: string): string {
  const match = from.match(/@([^>\s]+)/);
  return match ? match[1].toLowerCase() : "";
}

/** What the Email page in the console shows about the current setup. */
export function emailSetup() {
  const from = fromAddress();
  const mailFromRaw = env("MAIL_FROM");
  return {
    provider: resendConfigured() ? "Resend" : env("SMTP_HOST") ? "SMTP" : "None",
    keySet: resendConfigured(),
    keyLooksRight: resendKey().startsWith("re_"),
    keyHint: resendKey() ? `${resendKey().slice(0, 5)}…${resendKey().slice(-4)}` : "",
    from,
    fromDomain: fromDomain(from),
    usingTestSender: fromDomain(from) === "resend.dev",
    mailFromIsPlaceholder: Boolean(mailFromRaw) && isPlaceholder(mailFromRaw),
    replyTo: defaultReplyTo() ?? "",
    salesInbox: env("SALES_NOTIFICATION_EMAIL") || env("PLATFORM_ADMIN_EMAIL"),
    appUrl: env("NEXT_PUBLIC_APP_URL"),
  };
}

/**
 * Turn Resend's error into the fix, in plain words. Returns null when the
 * message is not one we recognise; the raw message is always shown as well.
 */
export function explainMailError(reason: string | undefined | null): string | null {
  if (!reason) return null;
  const r = reason.toLowerCase();
  if (r.includes("not configured"))
    return "RESEND_API_KEY is empty. Add it in Vercel (Settings, Environment Variables) and in .env, then redeploy. Vercel only picks up new settings after a redeploy.";
  if (r.includes("api key is invalid") || r.includes("401") || r.includes("missing api key"))
    return "Resend does not accept the API key. Create a new key in Resend (API Keys, Full access), paste it without quotes or spaces, save, and redeploy.";
  if (r.includes("only send testing emails") || r.includes("own email address"))
    return "You are sending from Resend's test address (onboarding@resend.dev). It can only send to the email you signed up to Resend with. Verify your own domain in Resend (Domains), then set MAIL_FROM to an address on that domain.";
  if (r.includes("domain is not verified") || r.includes("not verified"))
    return "The domain in MAIL_FROM is not verified in Resend. Open Resend, Domains, add the domain, copy the DNS records it gives you into your domain provider, and wait for it to show Verified.";
  if (r.includes("invalid `from`") || r.includes("from field") || r.includes("invalid from"))
    return 'MAIL_FROM is not written correctly. Use this shape: Coderswurld Inventory <no-reply@yourdomain.com>, with your real domain.';
  if (r.includes("rate limit") || r.includes("429"))
    return "Resend is limiting how fast you send. Wait a minute and try again. On the free plan the daily limit is 100 emails.";
  if (r.includes("fetch failed") || r.includes("enotfound") || r.includes("timeout"))
    return "The server could not reach Resend. Try again in a minute. If it keeps failing, check Resend's status page.";
  return null;
}

/**
 * Record each attempt. Never throws: a broken log must not stop an email or a
 * sale. The database is imported lazily so this file stays light.
 */
async function logAttempt(to: string, subject: string, result: DeliveryResult) {
  try {
    const { prisma } = await import("./db");
    await prisma.emailLog.create({
      data: {
        to: to.slice(0, 500),
        subject: subject.slice(0, 300),
        ok: result.delivered,
        providerId: result.id ?? null,
        error: result.delivered ? null : (result.reason ?? "Unknown error").slice(0, 1000),
      },
    });
  } catch (error) {
    console.error("[mail] could not write EmailLog:", error);
  }
}

/**
 * Send through Resend's HTTP API. A plain fetch instead of the SDK: one less
 * package, and it runs anywhere (Node, serverless, edge) with no SMTP port.
 */
async function sendWithResend(
  to: string[],
  message: MailMessage,
): Promise<DeliveryResult> {
  // RESEND_API_URL only exists so tests can point at a stand-in; leave it unset.
  const base = process.env.RESEND_API_URL?.trim() || "https://api.resend.com";
  const response = await fetch(`${base}/emails`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey()}`,
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

/**
 * Where replies go when an email doesn't say. Mail is sent from a no-reply
 * address, so without this a customer's reply ("here is my transfer receipt")
 * would vanish.
 */
function defaultReplyTo(): string | undefined {
  return (
    [env("MAIL_REPLY_TO"), env("SUPPORT_EMAIL"), env("SALES_NOTIFICATION_EMAIL"), env("PLATFORM_ADMIN_EMAIL")].find(
      (v) => v.includes("@") && !isPlaceholder(v),
    ) || undefined
  );
}

export async function sendMail(input: MailMessage): Promise<DeliveryResult> {
  const result = await deliver(input);
  const to = (Array.isArray(input.to) ? input.to : [input.to]).join(", ");
  if (to) await logAttempt(to, input.subject, result);
  return result;
}

async function deliver(input: MailMessage): Promise<DeliveryResult> {
  const message: MailMessage = { ...input, replyTo: input.replyTo ?? defaultReplyTo() };
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
    return { delivered: false, channel: "EMAIL", reason: "Email is not configured (RESEND_API_KEY is empty)." };
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
// Brand colours, written out because email clients don't read CSS variables.
const NAVY = "#1d3a8a";
const NAVY_DARK = "#14295f";
const ORANGE = "#c2410c";
const INK = "#0f172a";
const MUTED = "#64748b";
const LINE = "#e5e7eb";
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function siteBase(): string {
  return (process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://coderswurld.com").replace(/\/+$/, "");
}

/**
 * Every email the app sends goes through this shell, so they all look like
 * one brand: a navy header with the logo, an orange strip, a white card and a
 * footer with real contacts. Table layout and inline styles only, because
 * Gmail, Outlook and phone mail apps ignore most modern CSS.
 */
export function emailShell(options: {
  heading: string;
  preheader?: string;
  body: string;
  footer?: string;
  /** Small line above the heading, e.g. "Plan request CW-0012". */
  eyebrow?: string;
}): string {
  const { heading, preheader, body, footer, eyebrow } = options;
  const base = siteBase();
  // A real image, not SVG: Gmail and Outlook do not show SVG in emails.
  const markUrl = `${base}/icons/email-mark.png`;
  const support = [
    process.env.SUPPORT_EMAIL?.trim()
      ? `<a href="mailto:${escapeHtml(process.env.SUPPORT_EMAIL.trim())}" style="color:${NAVY};text-decoration:none;">${escapeHtml(process.env.SUPPORT_EMAIL.trim())}</a>`
      : "",
    process.env.SUPPORT_PHONE?.trim() ? escapeHtml(process.env.SUPPORT_PHONE.trim()) : "",
  ]
    .filter(Boolean)
    .join(" &nbsp;·&nbsp; ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background:#eef1f7;font-family:${FONT};color:${INK};-webkit-font-smoothing:antialiased;">
${
  preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(preheader)}&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;</div>`
    : ""
}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f7;padding:28px 12px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;">
      <!-- Header -->
      <tr>
        <td style="background:${NAVY};background-image:linear-gradient(135deg,${NAVY} 0%,${NAVY_DARK} 100%);border-radius:18px 18px 0 0;padding:22px 28px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="width:36px;height:36px;vertical-align:middle;"><img src="${markUrl}" width="36" height="36" alt="CW" style="display:block;border:0;border-radius:9px;width:36px;height:36px;color:#ffffff;font-size:13px;font-weight:800;font-family:${FONT};" /></td>
            <td style="padding-left:12px;font-size:17px;font-weight:700;color:#ffffff;font-family:${FONT};letter-spacing:-0.2px;">Coderswurld <span style="color:#fdba74;">Inventory</span></td>
          </tr></table>
        </td>
      </tr>
      <tr><td style="background:${ORANGE};height:4px;line-height:4px;font-size:0;">&nbsp;</td></tr>
      <!-- Card -->
      <tr>
        <td style="background:#ffffff;padding:32px 28px 8px;">
          ${eyebrow ? `<p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${ORANGE};">${escapeHtml(eyebrow)}</p>` : ""}
          <h1 style="margin:0 0 18px;font-size:24px;line-height:1.25;font-weight:800;color:${INK};letter-spacing:-0.4px;">${escapeHtml(heading)}</h1>
        </td>
      </tr>
      <tr>
        <td style="background:#ffffff;padding:0 28px 30px;font-size:15px;line-height:1.65;color:#334155;">
          ${body}
        </td>
      </tr>
      <!-- Footer -->
      <tr>
        <td style="background:#f8fafc;border-top:1px solid ${LINE};border-radius:0 0 18px 18px;padding:20px 28px;font-size:12.5px;line-height:1.6;color:${MUTED};">
          ${footer ?? "Sent by Coderswurld Inventory."}
          ${support ? `<br>Need help? ${support}` : ""}
        </td>
      </tr>
      <tr>
        <td align="center" style="padding:18px 8px 0;font-size:11.5px;color:#94a3b8;">
          Coderswurld Inventory &nbsp;·&nbsp; Inventory and POS for supermarkets and pharmacies<br>
          <a href="${escapeHtml(base)}" style="color:#94a3b8;">${escapeHtml(base.replace(/^https?:\/\//, ""))}</a>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

/** A plain paragraph in the email's body style. */
export function emailP(html: string, opts: { muted?: boolean; size?: number } = {}): string {
  return `<p style="margin:0 0 16px;font-size:${opts.size ?? 15}px;line-height:1.65;color:${opts.muted ? MUTED : "#334155"};">${html}</p>`;
}

/** Big amount block: "₦50,000 · Starter plan, one year". */
export function emailAmount(amount: string, caption: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 22px;">
  <tr><td style="background:#fff7ed;border:1px solid #fed7aa;border-radius:14px;padding:18px 20px;">
    <p style="margin:0;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${ORANGE};">Amount to pay</p>
    <p style="margin:4px 0 2px;font-size:32px;font-weight:800;letter-spacing:-0.8px;color:${INK};">${amount}</p>
    <p style="margin:0;font-size:13.5px;color:#7c2d12;">${caption}</p>
  </td></tr>
</table>`;
}

/** The bank details, laid out to copy at a glance. */
export function emailBankCard(details: { bank: string; accountName: string; accountNumber: string; narration: string }): string {
  const row = (label: string, value: string, big = false) => `
    <tr>
      <td style="padding:10px 0;border-top:1px solid rgba(255,255,255,0.14);font-size:12.5px;color:#c7d2fe;white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td>
      <td style="padding:10px 0 10px 16px;border-top:1px solid rgba(255,255,255,0.14);font-size:${big ? 22 : 15}px;font-weight:${big ? 800 : 700};color:#ffffff;text-align:right;letter-spacing:${big ? "2px" : "0"};font-family:${big ? "'SFMono-Regular',Consolas,'Liberation Mono',monospace" : FONT};">${escapeHtml(value)}</td>
    </tr>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;">
  <tr><td style="background:${NAVY};background-image:linear-gradient(135deg,${NAVY} 0%,${NAVY_DARK} 100%);border-radius:14px;padding:18px 20px 8px;">
    <p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#fdba74;">Pay by bank transfer</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${row("Bank", details.bank)}
      ${row("Account name", details.accountName)}
      ${row("Account number", details.accountNumber, true)}
      ${row("Narration", details.narration)}
    </table>
  </td></tr>
</table>`;
}

/** Numbered steps. */
export function emailSteps(steps: string[]): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
${steps
  .map(
    (s, i) => `  <tr>
    <td style="width:30px;vertical-align:top;padding:0 0 12px;">
      <div style="width:24px;height:24px;line-height:24px;border-radius:12px;background:#e0e7ff;color:${NAVY};font-size:12px;font-weight:800;text-align:center;">${i + 1}</div>
    </td>
    <td style="vertical-align:top;padding:2px 0 12px 8px;font-size:14.5px;line-height:1.55;color:#334155;">${s}</td>
  </tr>`,
  )
  .join("\n")}
</table>`;
}

/** A soft highlighted note. tone: info (blue), warn (orange), good (green). */
export function emailCallout(html: string, tone: "info" | "warn" | "good" = "info"): string {
  const t = {
    info: { bg: "#eef2ff", border: "#c7d2fe", text: "#1e3a8a" },
    warn: { bg: "#fff7ed", border: "#fed7aa", text: "#7c2d12" },
    good: { bg: "#ecfdf5", border: "#a7f3d0", text: "#065f46" },
  }[tone];
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
  <tr><td style="background:${t.bg};border:1px solid ${t.border};border-radius:12px;padding:14px 16px;font-size:14px;line-height:1.55;color:${t.text};">${html}</td></tr>
</table>`;
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
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;margin:4px 0 22px;border:1px solid ${LINE};border-radius:12px;">
${rows
  .map(
    ([label, value], index) => `  <tr>
    <td style="padding:11px 14px;font-size:12.5px;color:${MUTED};white-space:nowrap;vertical-align:top;border-top:${index === 0 ? "none" : `1px solid ${LINE}`};">${escapeHtml(label)}</td>
    <td style="padding:11px 14px;font-size:14.5px;color:${INK};font-weight:600;vertical-align:top;text-align:right;border-top:${index === 0 ? "none" : `1px solid ${LINE}`};">${value}</td>
  </tr>`,
  )
  .join("\n")}
</table>`;
}

/** A big, tappable button that also works in Outlook. */
export function emailButton(href: string, label: string, tone: "orange" | "navy" = "orange"): string {
  const bg = tone === "navy" ? NAVY : ORANGE;
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 20px;">
  <tr><td style="background:${bg};border-radius:12px;box-shadow:0 2px 0 rgba(0,0,0,0.08);">
    <a href="${escapeHtml(href)}" style="display:inline-block;padding:14px 26px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;font-family:${FONT};">${escapeHtml(label)}</a>
  </td></tr>
</table>`;
}
