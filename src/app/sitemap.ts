import type { MetadataRoute } from "next";
import { isLiveSite } from "@/lib/seo";

/** Public pages, on the live site only (previews have no sitemap). */
export default function sitemap(): MetadataRoute.Sitemap {
  if (!isLiveSite()) return [];
  const base = process.env.PUBLIC_BASE_URL || "https://hupup.vercel.app";
  return ["", "/privacy", "/terms", "/sms-terms", "/text-alerts"].map((p) => ({ url: `${base}${p}`, changeFrequency: "monthly", priority: p ? 0.3 : 1 }));
}
