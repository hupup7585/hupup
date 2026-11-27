import { signingSecret } from "@/lib/secret";
import crypto from "node:crypto";

/**
 * Signed page messages (Hark's review L11, Nov 26, 2026): a "Saved" or "Not saved" line carried in the page address
 * is shown only when it was written by our own Save action. Anyone can type ?m=Published into an address; without the
 * matching signature the page shows nothing, so a fake message can never appear.
 */
const sig = (text: string) => crypto.createHmac("sha256", signingSecret()).update(`msg:${text}`).digest("hex").slice(0, 16);

/** The address part for a message: name=text&names=signature */
export function msgQuery(text: string, name = "m"): string {
  return `${name}=${encodeURIComponent(text)}&${name}s=${sig(text)}`;
}

/** The message text when its signature matches, otherwise null (never shown). */
export function trustedMsg(text: string | undefined | null, signature: string | undefined | null): string | null {
  if (!text || !signature) return null;
  const want = sig(text);
  return signature.length === want.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(want)) ? text : null;
}
