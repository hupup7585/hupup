export const BUSINESS_NAME = "Hup Up Attractions";
/** The Owner's first name, shown in staff greetings (Abraham). */
export const OWNER_FIRST_NAME = "Abraham";
/** The Owner's full name on the staff account (Abraham). */
export const OWNER_FULL_NAME = "Abraham Schwartz";
export const DEFAULT_VOICE = "Google.en-US-Chirp3-HD-Fenrir";
/** Public business number for the website (forwards to the Twilio hotline). */
export const PUBLIC_PHONE_DISPLAY = "(845) 777-7585";
export const PUBLIC_PHONE_E164 = "+18457777585";

/** Public email on the website. Gmail stays on the live site until Abraham confirms the new mailbox works. */
export const LIVE_PUBLIC_EMAIL = "hupupattractions@gmail.com";
export const NEW_PUBLIC_EMAIL = "info@hupupattractions.com";
/** Flip to true once Abraham says info@hupupattractions.com works; then the live site shows it too. */
export const NEW_EMAIL_LIVE = false;

/**
 * The email the public website shows (footer, contact, legal pages, business schema): info@ on previews,
 * gmail on the live site until NEW_EMAIL_LIVE. `stored` is an owner-saved site email, used on the live site only.
 */
export function publicEmail(env: Record<string, string | undefined> = process.env, stored?: string | null): string {
  if (NEW_EMAIL_LIVE || env.VERCEL_ENV !== "production") return NEW_PUBLIC_EMAIL;
  return stored || LIVE_PUBLIC_EMAIL;
}

export const config = {
  baseUrl: () => (process.env.PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/$/, ""),
  /**
   * PUBLIC number shown on the website (display + tel: links only). Abram forwards it to the
   * Twilio hotline. The IVR, transfers and SMS sending use TWILIO_PHONE_NUMBER, never this.
   */
  hotlineDisplay: process.env.NEXT_PUBLIC_HOTLINE_DISPLAY || PUBLIC_PHONE_DISPLAY,
  hotlineE164: process.env.NEXT_PUBLIC_HOTLINE_E164 || PUBLIC_PHONE_E164,
  /** Hotline voice. Abram's choice: Google Chirp3-HD "Fenrir" (young, friendly male). Plain text only, no SSML. */
  voice: () => process.env.IVR_VOICE || DEFAULT_VOICE,
  adminEmail: () => process.env.ADMIN_EMAIL || "",
  adminPhone: () => process.env.ADMIN_PHONE || "",
  forwardPhone: () => process.env.FORWARD_PHONE || process.env.ADMIN_PHONE || "",
  twilioConfigured: () => Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
  resendConfigured: () => Boolean(process.env.RESEND_API_KEY),
  solaConfigured: () => Boolean(process.env.SOLA_PAYMENTSITE_NAME),
  isProd: () => process.env.NODE_ENV === "production",
};
