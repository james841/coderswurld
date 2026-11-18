import type { MetadataRoute } from "next";

import { PRIVATE_PATHS, siteUrl } from "@/lib/site";

/** /robots.txt: crawl the public site, stay out of every signed-in area. */
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  // Preview deployments on *.vercel.app must not compete with the real domain.
  const isProduction = !process.env.VERCEL_ENV || process.env.VERCEL_ENV === "production";
  return {
    rules: isProduction
      ? [{ userAgent: "*", allow: ["/", "/signin"], disallow: PRIVATE_PATHS }]
      : [{ userAgent: "*", disallow: "/" }],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
