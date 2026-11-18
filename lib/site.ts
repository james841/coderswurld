/**
 * The site's public address, for the sitemap, robots, share cards and emails.
 * Set NEXT_PUBLIC_APP_URL to your real domain (https://coderswurld.com) on Vercel.
 * Falls back to Vercel's own address, then localhost, so nothing breaks unset.
 */
export function siteUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

/** Signed-in areas. Search engines are kept out of all of these. */
export const PRIVATE_PATHS = [
  "/api/",
  "/dashboard",
  "/products",
  "/stock",
  "/suppliers",
  "/purchases",
  "/receipts",
  "/sales",
  "/customers",
  "/expenses",
  "/reports",
  "/staff",
  "/settings",
  "/receipt-design",
  "/hardware",
  "/pos",
  "/platform",
  "/launch",
  "/locked",
  "/change-password",
];
