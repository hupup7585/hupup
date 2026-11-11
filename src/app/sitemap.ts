import type { MetadataRoute } from "next";
import { isLiveSite } from "@/lib/seo";
import { termsActive } from "@/lib/rental-terms";

/** Public pages, on the live site only (previews have no sitemap). */
export default function sitemap(): MetadataRoute.Sitemap {
  if (!isLiveSite()) return [];
  const base = process.env.PUBLIC_BASE_URL || "https://hupupattractions.com";
  return ["", "/privacy", ...(termsActive() ? ["/terms"] : []), "/sms-terms", "/text-alerts"].map((p) => ({ url: `${base}${p}`, changeFrequency: "monthly", priority: p ? 0.3 : 1 }));
}
