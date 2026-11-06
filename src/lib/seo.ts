/**
 * SEO switches (Abraham's SEO rule, see CLAUDE.md). Only the live production site is indexed; previews and local
 * builds are always noindex, with no sitemap.
 */
export function isLiveSite(env: Record<string, string | undefined> = process.env) {
  return env.VERCEL_ENV === "production";
}

export const SITE_NAME = "Hup Up Attractions";
export const PHONE_DISPLAY = "(845) 777-7585";
