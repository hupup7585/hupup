import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.PUBLIC_BASE_URL || "https://hupup.vercel.app";
  return ["", "/privacy", "/terms", "/sms-terms", "/text-alerts"].map((p) => ({ url: `${base}${p}`, changeFrequency: "monthly", priority: p ? 0.3 : 1 }));
}
