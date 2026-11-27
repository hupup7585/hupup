import type { MetadataRoute } from "next";
import { isLiveSite } from "@/lib/seo";
import { termsActive } from "@/lib/rental-terms";
import { config } from "@/lib/config";

/** Public pages, on the live site only (previews have no sitemap). */
export default function sitemap(): MetadataRoute.Sitemap {
  if (!isLiveSite()) return [];
  const base = config.siteUrl(); // the real site address, never a vercel.app one (item 7, Nov 25, 2026)
  return ["", "/privacy", ...(termsActive() ? ["/terms"] : []), "/sms-terms", "/text-alerts"].map((p) => ({ url: `${base}${p}`, changeFrequency: "monthly", priority: p ? 0.3 : 1 }));
}
