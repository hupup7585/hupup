/**
 * The key every signed link and code uses (Code audit L6, Nov 24, 2026). On the live site a missing or short
 * AUTH_SECRET stops the signing (the link or code is not sent) instead of signing with a known test value that anyone
 * could copy. Tests and local development keep the test value.
 */
export function signingSecret(env: Record<string, string | undefined> = process.env): string {
  const s = env.AUTH_SECRET;
  if (s && s.length >= 24) return s;
  if (env.NODE_ENV === "production" || env.VERCEL_ENV === "production") throw new Error("AUTH_SECRET must be set (24+ characters) in Vercel. Links and codes are not signed without it.");
  return s || "dev-secret";
}
