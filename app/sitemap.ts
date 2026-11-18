import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site";

/**
 * /sitemap.xml: the public pages Google should know about. The landing page
 * holds pricing, features and FAQ as sections, so it is one URL. Add any new
 * public page (blog, terms, privacy) here.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  const now = new Date();
  return [
    { url: `${base}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/signin`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
  ];
}
