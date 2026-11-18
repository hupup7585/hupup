import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Sola bridge (Abraham, Nov 18, 2026): admin-only endpoints that read Sola transactions and void a charge, using
 * SOLA_API_KEY on the server. Read and void only: no new charges, ever. Callers send a separate admin API key in the
 * "x-admin-api-key" header; it is compared with SOLA_BRIDGE_API_KEY (set in Vercel, never in the code). Without that
 * key in Vercel the bridge is off.
 */
export function bridgeKeyOk(header: string | null, env: Record<string, string | undefined> = process.env): boolean {
  const want = env.SOLA_BRIDGE_API_KEY ?? "";
  if (want.length < 24 || !header) return false; // off until a long key is saved
  const a = createHash("sha256").update(header).digest();
  const b = createHash("sha256").update(want).digest();
  return timingSafeEqual(a, b);
}

/** "2026-11-18" or a full ISO time; null when not a date. */
export function parseWhen(v: string | null, endOfDay = false): Date | null {
  if (!v) return null;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T${endOfDay ? "23:59:59" : "00:00:00"}-05:00`) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
