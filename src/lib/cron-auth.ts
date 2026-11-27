import { timingSafeEqual } from "node:crypto";

/**
 * Extra check G9 (Nov 27, 2026): the scheduled jobs' "Authorization: Bearer <CRON_SECRET>" is compared in constant
 * time, so the secret can't be guessed from how long a wrong answer takes. No secret set: always refused.
 */
export function cronAuthorized(header: string | null | undefined, secret: string | undefined = process.env.CRON_SECRET): boolean {
  if (!secret) return false;
  const want = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(header ?? "");
  return got.length === want.length && timingSafeEqual(got, want);
}
