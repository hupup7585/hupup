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

/** Phone line recordings (Abraham, Phone Recordings): a fixed signed link Twilio can play; no expiry, not guessable. */
const signPrompt = (id: number) => createHmac("sha256", process.env.AUTH_SECRET || "dev-secret").update(`prompt-recording:${id}`).digest("hex").slice(0, 32);

export function promptRecordingLink(id: number): string {
  return `${config.baseUrl()}/api/voice-audio/prompt/${id}?sig=${signPrompt(id)}`;
}

export function verifyPromptRecordingLink(id: number, sig: string | null): boolean {
  if (!Number.isInteger(id) || id <= 0 || !sig) return false;
  const want = Buffer.from(signPrompt(id));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** The customer's own invoice page (Abraham, Nov 15, 2026): a fixed signed link, no sign-in, not guessable. */
const signInvoice = (id: number) => createHmac("sha256", process.env.AUTH_SECRET || "dev-secret").update(`invoice:${id}`).digest("hex").slice(0, 32);

export function invoiceCustomerLink(id: number): string {
  return `${config.baseUrl()}/invoice/${id}?t=${signInvoice(id)}`;
}

export function verifyInvoiceLink(id: number, t: string | null | undefined): boolean {
  if (!Number.isInteger(id) || id <= 0 || !t) return false;
  const want = Buffer.from(signInvoice(id));
  const got = Buffer.from(t);
  return want.length === got.length && timingSafeEqual(want, got);
}

/**
 * Option B (Abraham, Nov 15, 2026; off until the Owner turns it on): a changing line spoken in Achird by Google, made
 * when Twilio fetches it. Signed so only our own words can be turned into audio.
 */
const signLive = (text: string) => createHmac("sha256", process.env.AUTH_SECRET || "dev-secret").update(`live-voice:${text}`).digest("hex").slice(0, 32);
export function liveVoiceLink(text: string): string {
  return `${config.baseUrl()}/api/voice-audio/live?t=${Buffer.from(text).toString("base64url")}&sig=${signLive(text)}`;
}
export function verifyLiveVoiceLink(t: string | null, sig: string | null): string | null {
  if (!t || !sig) return null;
  const text = Buffer.from(t, "base64url").toString("utf8");
  const want = Buffer.from(signLive(text));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got) ? text : null;
}

/** A delivery photo for a picture text: Twilio fetches it once; the link works for 30 minutes only (Abraham, Nov 16, 2026). */
const signPhoto = (id: number, exp: number) => createHmac("sha256", process.env.AUTH_SECRET || "dev-secret").update(`delivery-photo:${id}:${exp}`).digest("hex").slice(0, 32);
export function deliveryPhotoLink(id: number, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + 30 * 60;
  return `${config.baseUrl()}/api/media/delivery-photo/${id}?exp=${exp}&sig=${signPhoto(id, exp)}`;
}
export function verifyDeliveryPhotoLink(id: number, exp: number, sig: string | null, now = Date.now()): boolean {
  if (!sig || !Number.isInteger(id) || !Number.isFinite(exp) || exp * 1000 < now) return false;
  const want = Buffer.from(signPhoto(id, exp));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** A file sent with a text (Abraham, Nov 16, 2026): Twilio fetches it; the link works for 24 hours. */
const signMsgFile = (id: number, exp: number) => createHmac("sha256", process.env.AUTH_SECRET || "dev-secret").update(`message-file:${id}:${exp}`).digest("hex").slice(0, 32);
export function messageFileLink(id: number, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + 24 * 3600;
  return `${config.baseUrl()}/api/media/message-file/${id}?exp=${exp}&sig=${signMsgFile(id, exp)}`;
}
export function verifyMessageFileLink(id: number, exp: number, sig: string | null, now = Date.now()): boolean {
  if (!sig || !Number.isInteger(id) || !Number.isFinite(exp) || exp * 1000 < now) return false;
  const want = Buffer.from(signMsgFile(id, exp));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

/**
 * The shared secret between the Cloudflare info@ email Worker and our site (Abraham, Nov 16, 2026). INBOUND_EMAIL_SECRET
 * when set; otherwise made from AUTH_SECRET, so the live build can give it to the Worker without anyone seeing it.
 */
export function inboundEmailSecret(env: Record<string, string | undefined> = process.env): string {
  if (env.INBOUND_EMAIL_SECRET) return env.INBOUND_EMAIL_SECRET;
  if (!env.AUTH_SECRET) return "";
  return createHmac("sha256", env.AUTH_SECRET).update("inbound-email:v1").digest("hex");
}
