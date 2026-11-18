import "server-only";

import type { DeliveryResult } from "./mail";

/**
 * WhatsApp delivery via the Meta WhatsApp Business Cloud API.
 *
 * This is the channel most Nigerian shop owners will actually pick for the
 * daily sales report — they read WhatsApp, they don't read email.
 *
 * Like email, an unconfigured channel logs and returns `delivered: false`
 * rather than throwing. The settings screen surfaces that state so the owner
 * knows the channel isn't live, instead of silently believing reports are going
 * out.
 *
 * NOTE ON THE 24-HOUR WINDOW: Cloud API only allows free-form text to a number
 * that has messaged your business within 24 hours. Outside that window Meta
 * requires a pre-approved template. `sendWhatsAppText` handles the common case;
 * `sendWhatsAppTemplate` exists for once the business has a template approved.
 */

export function isWhatsAppConfigured(): boolean {
  return Boolean(
    process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() &&
      process.env.WHATSAPP_ACCESS_TOKEN?.trim(),
  );
}

/**
 * Normalise a Nigerian number to the E.164 digits Meta expects (no leading +).
 *
 *   0803 123 4567   -> 2348031234567
 *   +234 803 123... -> 2348031234567
 *   803 123 4567    -> 2348031234567
 */
export function normalizeNigerianPhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (!digits) return null;

  if (digits.startsWith("234")) {
    // 234 + 10 national digits
    return digits.length === 13 ? digits : null;
  }
  if (digits.startsWith("0")) {
    // 0 + 10 national digits
    return digits.length === 11 ? `234${digits.slice(1)}` : null;
  }
  if (digits.length === 10) {
    return `234${digits}`;
  }
  // Already an international number for somewhere else — pass it through.
  return digits.length >= 11 && digits.length <= 15 ? digits : null;
}

async function callGraph(
  payload: Record<string, unknown>,
): Promise<DeliveryResult> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID!.trim();
  const token = process.env.WHATSAPP_ACCESS_TOKEN!.trim();
  const version = process.env.WHATSAPP_API_VERSION?.trim() || "v21.0";

  try {
    const response = await fetch(
      `https://graph.facebook.com/${version}/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        // A report send must never hold a cron request open indefinitely.
        signal: AbortSignal.timeout(15_000),
      },
    );

    const body = (await response.json().catch(() => ({}))) as {
      messages?: Array<{ id: string }>;
      error?: { message?: string };
    };

    if (!response.ok) {
      const reason = body.error?.message ?? `HTTP ${response.status}`;
      console.error("[whatsapp] send failed:", reason);
      return { delivered: false, channel: "WHATSAPP", reason };
    }

    return {
      delivered: true,
      channel: "WHATSAPP",
      id: body.messages?.[0]?.id,
    };
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "Unknown WhatsApp API error.";
    console.error("[whatsapp] send failed:", reason);
    return { delivered: false, channel: "WHATSAPP", reason };
  }
}

export async function sendWhatsAppText(
  to: string,
  body: string,
): Promise<DeliveryResult> {
  const phone = normalizeNigerianPhone(to);
  if (!phone) {
    return {
      delivered: false,
      channel: "WHATSAPP",
      reason: `"${to}" is not a valid phone number.`,
    };
  }

  if (!isWhatsAppConfigured()) {
    console.info(
      [
        "",
        "┌─ WHATSAPP (not sent — API credentials missing) ─────────────────────",
        `│ To: +${phone}`,
        "├────────────────────────────────────────────────────────────────────",
        body
          .split("\n")
          .map((line) => `│ ${line}`)
          .join("\n"),
        "└────────────────────────────────────────────────────────────────────",
        "",
      ].join("\n"),
    );
    return {
      delivered: false,
      channel: "WHATSAPP",
      reason: "WhatsApp is not connected.",
    };
  }

  return callGraph({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: phone,
    type: "text",
    // Report bodies contain no links; disabling preview avoids Meta rendering
    // an unwanted card if a shop name happens to look like a domain.
    text: { preview_url: false, body: body.slice(0, 4096) },
  });
}

export async function sendWhatsAppTemplate(
  to: string,
  templateName: string,
  parameters: string[],
  languageCode = "en",
): Promise<DeliveryResult> {
  const phone = normalizeNigerianPhone(to);
  if (!phone) {
    return { delivered: false, channel: "WHATSAPP", reason: `"${to}" is not a valid phone number.` };
  }
  if (!isWhatsAppConfigured()) {
    return { delivered: false, channel: "WHATSAPP", reason: "WhatsApp is not connected." };
  }

  return callGraph({
    messaging_product: "whatsapp",
    to: phone,
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      components: parameters.length
        ? [
            {
              type: "body",
              parameters: parameters.map((text) => ({ type: "text", text })),
            },
          ]
        : undefined,
    },
  });
}
