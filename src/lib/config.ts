export const BUSINESS_NAME = "Hup Up Attractions";
/** The Owner's first name, shown in staff greetings (Abraham). */
export const OWNER_FIRST_NAME = "Abraham";
/** The Owner's full name on the staff account (Abraham). */
export const OWNER_FULL_NAME = "Abraham Schwartz";
export const DEFAULT_VOICE = "Google.en-US-Chirp3-HD-Puck"; // Abraham, Nov 15, 2026: the live voice stays Puck

/**
 * Safety (Abraham, Nov 15, 2026): Twilio rejected "Google.en-US-Chirp3-HD-Achird" in Say (error 13520) and calls
 * dropped. Only voices Twilio is known to accept are ever used; anything else falls back to Puck, so a wrong voice
 * setting can never hang up a caller.
 */
const TWILIO_CHIRP3_HD = ["Aoede", "Charon", "Fenrir", "Kore", "Leda", "Orus", "Puck", "Zephyr"];
export function safeVoice(v: string | undefined | null): string {
  const name = (v ?? "").trim();
  const ok =
    TWILIO_CHIRP3_HD.some((n) => name === `Google.en-US-Chirp3-HD-${n}`) ||
    /^Google\.en-US-(Neural2|Standard|Wavenet)-[A-J]$/.test(name) ||
    /^Polly\.[A-Z][a-z]+(-Neural|-Generative)?$/.test(name) ||
    ["man", "woman", "alice"].includes(name);
  return ok ? name : DEFAULT_VOICE;
}
/** Public business number for the website (forwards to the Twilio hotline). */
export const PUBLIC_PHONE_DISPLAY = "(845) 777-7585";
export const PUBLIC_PHONE_E164 = "+18457777585";

/** Public email on the website. Gmail stays on the live site until Abraham confirms the new mailbox works. */
export const LIVE_PUBLIC_EMAIL = "hupupattractions@gmail.com";
export const NEW_PUBLIC_EMAIL = "info@hupupattractions.com";
/** Flip to true once Abraham says info@hupupattractions.com works; then the live site shows it too. */
export const NEW_EMAIL_LIVE = true; // Abraham, Nov 10, 2026: "info@hupupattractions.com already exists. Change it every place."

/**
 * The email the public website shows (footer, contact, legal pages, business schema): info@ on previews,
 * gmail on the live site until NEW_EMAIL_LIVE. `stored` is an owner-saved site email, used on the live site only.
 */
export function publicEmail(env: Record<string, string | undefined> = process.env, stored?: string | null): string {
  // SMS v3 (Abraham): hupupattractions@gmail.com everywhere, previews included, until info@ works
  if (NEW_EMAIL_LIVE) return NEW_PUBLIC_EMAIL;
  void env;
  return stored || LIVE_PUBLIC_EMAIL;
}

export const config = {
  baseUrl: () => (process.env.PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/$/, ""),
  /**
   * The address in every customer link (Abraham, Nov 25, 2026): https://hupupattractions.com on the live site, never a
   * vercel.app address. Twilio's callbacks keep using baseUrl. PUBLIC_SITE_URL overrides it.
   */
  siteUrl: () => (process.env.PUBLIC_SITE_URL || (process.env.VERCEL_ENV === "production" ? "https://hupupattractions.com" : process.env.PUBLIC_BASE_URL || "http://localhost:3000")).replace(/\/$/, ""),
  /**
   * PUBLIC number shown on the website (display + tel: links only). Abram forwards it to the
   * Twilio hotline. The IVR, transfers and SMS sending use TWILIO_PHONE_NUMBER, never this.
   */
  hotlineDisplay: process.env.NEXT_PUBLIC_HOTLINE_DISPLAY || PUBLIC_PHONE_DISPLAY,
  hotlineE164: process.env.NEXT_PUBLIC_HOTLINE_E164 || PUBLIC_PHONE_E164,
  /** Hotline voice. Abram's choice: Google Chirp3-HD "Fenrir" (young, friendly male). Plain text only, no SSML. */
  voice: () => safeVoice(process.env.IVR_VOICE),
  adminEmail: () => process.env.ADMIN_EMAIL || "",
  adminPhone: () => process.env.ADMIN_PHONE || "",
  forwardPhone: () => process.env.FORWARD_PHONE || process.env.ADMIN_PHONE || "",
  twilioConfigured: () => Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
  resendConfigured: () => Boolean(process.env.RESEND_API_KEY),
  solaConfigured: () => Boolean(process.env.SOLA_PAYMENTSITE_NAME),
  isProd: () => process.env.NODE_ENV === "production",
};
