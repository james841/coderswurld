/**
 * Helpers for the public-site traffic tracking.
 *
 * Everything here works from what the browser sends (referrer, user agent,
 * time zone) plus the country header some hosts add. Nothing identifies a
 * person: no IP address and no cookie are stored.
 */

export const CHANNELS = ["SEARCH", "SOCIAL", "REFERRAL", "CAMPAIGN", "DIRECT"] as const;
export type Channel = (typeof CHANNELS)[number];

export const CHANNEL_LABELS: Record<Channel, string> = {
  SEARCH: "Search engines",
  SOCIAL: "Social media",
  REFERRAL: "Other websites",
  CAMPAIGN: "Campaign links",
  DIRECT: "Direct (typed or saved)",
};

const SEARCH: Record<string, string> = {
  google: "Google",
  bing: "Bing",
  yahoo: "Yahoo",
  duckduckgo: "DuckDuckGo",
  yandex: "Yandex",
  baidu: "Baidu",
  ecosia: "Ecosia",
  "search.brave": "Brave Search",
  perplexity: "Perplexity",
  chatgpt: "ChatGPT",
};

const SOCIAL: Record<string, string> = {
  facebook: "Facebook",
  "fb.com": "Facebook",
  "fb.me": "Facebook",
  instagram: "Instagram",
  "t.co": "X (Twitter)",
  twitter: "X (Twitter)",
  "x.com": "X (Twitter)",
  linkedin: "LinkedIn",
  "lnkd.in": "LinkedIn",
  tiktok: "TikTok",
  whatsapp: "WhatsApp",
  "wa.me": "WhatsApp",
  youtube: "YouTube",
  "youtu.be": "YouTube",
  telegram: "Telegram",
  "t.me": "Telegram",
  pinterest: "Pinterest",
  reddit: "Reddit",
  snapchat: "Snapchat",
  threads: "Threads",
  nairaland: "Nairaland",
};

function match(host: string, table: Record<string, string>): string | null {
  for (const [key, label] of Object.entries(table)) {
    if (key.includes(".") ? host === key || host.endsWith("." + key) : host.split(".").includes(key)) {
      return label;
    }
  }
  return null;
}

/** Work out a friendly source name and its channel. */
export function classifySource(input: {
  referrerHost: string | null;
  utmSource: string | null;
  utmMedium: string | null;
}): { source: string; channel: Channel } {
  const host = input.referrerHost;
  if (input.utmSource) {
    const utm = input.utmSource.toLowerCase();
    const social = match(utm, SOCIAL) ?? match(utm + ".com", SOCIAL);
    const label = social ?? match(utm, SEARCH) ?? input.utmSource;
    return { source: label, channel: "CAMPAIGN" };
  }
  if (!host) return { source: "Direct", channel: "DIRECT" };
  const search = match(host, SEARCH);
  if (search) return { source: search, channel: "SEARCH" };
  const social = match(host, SOCIAL);
  if (social) return { source: social, channel: "SOCIAL" };
  return { source: host, channel: "REFERRAL" };
}

const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|lighthouse|pingdom|monitor|curl|wget|python|axios|node-fetch|go-http/i;

export function isBot(userAgent: string): boolean {
  return !userAgent || BOT.test(userAgent);
}

export function parseUserAgent(ua: string): { device: "MOBILE" | "TABLET" | "DESKTOP"; browser: string | null; os: string | null } {
  const device = /ipad|tablet|(android(?!.*mobile))/i.test(ua)
    ? "TABLET"
    : /mobi|iphone|ipod|android|opera mini/i.test(ua)
      ? "MOBILE"
      : "DESKTOP";
  const browser = /edg\//i.test(ua)
    ? "Edge"
    : /opr\/|opera/i.test(ua)
      ? "Opera"
      : /samsungbrowser/i.test(ua)
        ? "Samsung Internet"
        : /firefox|fxios/i.test(ua)
          ? "Firefox"
          : /chrome|crios/i.test(ua)
            ? "Chrome"
            : /safari/i.test(ua)
              ? "Safari"
              : null;
  const os = /windows/i.test(ua)
    ? "Windows"
    : /iphone|ipad|ipod/i.test(ua)
      ? "iOS"
      : /android/i.test(ua)
        ? "Android"
        : /mac os/i.test(ua)
          ? "macOS"
          : /linux/i.test(ua)
            ? "Linux"
            : null;
  return { device, browser, os };
}

/** Time zones of the countries most likely to visit, mapped to ISO codes. */
const TZ_COUNTRY: Record<string, string> = {
  "Africa/Lagos": "NG",
  "Africa/Accra": "GH",
  "Africa/Nairobi": "KE",
  "Africa/Johannesburg": "ZA",
  "Africa/Cairo": "EG",
  "Africa/Abidjan": "CI",
  "Africa/Douala": "CM",
  "Africa/Kampala": "UG",
  "Africa/Dar_es_Salaam": "TZ",
  "Africa/Kigali": "RW",
  "Africa/Lome": "TG",
  "Africa/Porto-Novo": "BJ",
  "Africa/Dakar": "SN",
  "Africa/Casablanca": "MA",
  "Africa/Addis_Ababa": "ET",
  "Europe/London": "GB",
  "Europe/Dublin": "IE",
  "Europe/Paris": "FR",
  "Europe/Berlin": "DE",
  "Europe/Amsterdam": "NL",
  "Europe/Madrid": "ES",
  "Europe/Rome": "IT",
  "America/New_York": "US",
  "America/Chicago": "US",
  "America/Denver": "US",
  "America/Los_Angeles": "US",
  "America/Toronto": "CA",
  "America/Vancouver": "CA",
  "Asia/Dubai": "AE",
  "Asia/Kolkata": "IN",
  "Asia/Calcutta": "IN",
  "Asia/Shanghai": "CN",
  "Asia/Singapore": "SG",
  "Asia/Riyadh": "SA",
  "Australia/Sydney": "AU",
};

/** Country from the host's edge header first (accurate), else the time zone. */
export function resolveCountry(headers: Headers, timezone: string | null): string | null {
  const header =
    headers.get("cf-ipcountry") ??
    headers.get("x-vercel-ip-country") ??
    headers.get("x-country-code") ??
    headers.get("cloudfront-viewer-country");
  if (header && /^[A-Z]{2}$/i.test(header) && header.toUpperCase() !== "XX") return header.toUpperCase();
  if (timezone && TZ_COUNTRY[timezone]) return TZ_COUNTRY[timezone];
  return null;
}

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

export function countryName(code: string | null): string {
  if (!code) return "Unknown";
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

/** 🇳🇬 from "NG". */
export function countryFlag(code: string | null): string {
  if (!code || code.length !== 2) return "🌍";
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
