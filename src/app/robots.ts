import type { MetadataRoute } from "next";
import { isLiveSite } from "@/lib/seo";

/** Live site: crawl the public pages, point to the sitemap. Previews: block everything (they stay noindex). */
export default function robots(): MetadataRoute.Robots {
  if (!isLiveSite()) return { rules: [{ userAgent: "*", disallow: "/" }] };
  const base = process.env.PUBLIC_BASE_URL || "https://hupup.vercel.app";
  return { rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/api", "/mockups", "/pay", "/paid"] }], sitemap: `${base}/sitemap.xml` };
}
