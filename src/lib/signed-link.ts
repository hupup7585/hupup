import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "@/lib/config";

/** Private play links for voicemail alerts: signed with AUTH_SECRET, expire after `days` (default 14). No sign-in needed. */
const sign = (id: number, exp: number) => createHmac("sha256", process.env.AUTH_SECRET || "dev-secret").update(`voicemail:${id}:${exp}`).digest("hex").slice(0, 32);

export function voicemailPlayLink(id: number, days = 14, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + days * 86_400;
  return `${config.baseUrl()}/api/voicemail/play/${id}?exp=${exp}&sig=${sign(id, exp)}`;
}

export function verifyVoicemailLink(id: number, exp: string | null, sig: string | null, now = Date.now()): boolean {
  const e = Number(exp);
  if (!Number.isInteger(id) || !Number.isFinite(e) || !sig || e < now / 1000) return false;
  const want = Buffer.from(sign(id, e));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}
