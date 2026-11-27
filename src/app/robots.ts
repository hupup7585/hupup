import type { MetadataRoute } from "next";
import { isLiveSite } from "@/lib/seo";
import { config } from "@/lib/config";

/** Live site: crawl the public pages, point to the sitemap. Previews: block everything (they stay noindex). */
export default function robots(): MetadataRoute.Robots {
  if (!isLiveSite()) return { rules: [{ userAgent: "*", disallow: "/" }] };
  const base = config.siteUrl(); // the real site address, never a vercel.app one (item 7, Nov 25, 2026)
  return { rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/api", "/mockups", "/pay", "/paid"] }], sitemap: `${base}/sitemap.xml` };
}
