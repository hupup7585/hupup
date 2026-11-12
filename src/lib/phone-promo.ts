import { toE164 } from "@/lib/phone";

/**
 * Promo texts by phone, keys only (Abraham, Nov 10, 2026). Replaces the long spoken promo question, which is no
 * longer played to anyone.
 *
 * "off"        : no promo question on the phone at all.
 * "owner_test" : only calls from the Owner's own phone (ADMIN_PHONE) hear the new flow, for Abraham's test call;
 *                every other caller goes straight to goodbye. Nothing customer-facing.
 * "live"       : every caller hears it. Abraham turns this on only after he approves the final wording and the test
 *                call. Texts still go out only once Twilio A2P is approved (the texting gate blocks them until then).
 */
export type PhonePromoMode = "off" | "owner_test" | "live";
export const PHONE_PROMO_MODE: PhonePromoMode = "off"; // Abraham (Phone Menu v3): off until SMS Terms v3 is live and he approves the wording and a test recording

export function phonePromoMode(): PhonePromoMode {
  return PHONE_PROMO_MODE;
}

export const OWNER_TEST_PHONE_FALLBACK = "+18457777585";

/** Does this caller hear the keys-only promo question? */
export function phonePromoOn(callerFrom: string | null | undefined, mode: PhonePromoMode = phonePromoMode(), env: Record<string, string | undefined> = process.env): boolean {
  if (mode === "live") return true;
  if (mode === "off") return false;
  const caller = toE164(callerFrom);
  const owner = toE164(env.ADMIN_PHONE) ?? OWNER_TEST_PHONE_FALLBACK;
  return Boolean(caller && caller === owner);
}

/** Step 3: exactly 10 digits (a US mobile number). Anything else is "didn't work". */
export function tenDigitNumber(digits: string | null | undefined): string | null {
  const d = (digits ?? "").replace(/[^0-9]/g, "");
  if (d.length !== 10 || (digits ?? "").replace(/[#\s]/g, "").length !== 10) return null;
  return `+1${d}`;
}

/** "8 4 5, 5 5 5, 1 2 3 4" */
export function readBack(e164: string): string {
  const d = e164.replace(/\D/g, "").slice(-10);
  const sp = (s: string) => s.split("").join(" ");
  return `${sp(d.slice(0, 3))}, ${sp(d.slice(3, 6))}, ${sp(d.slice(6))}`;
}

/** Date, time and year for the consent log, in New York time plus the exact UTC moment. */
export function logStamp(now = new Date()): string {
  const ny = now.toLocaleString("en-US", { timeZone: "America/New_York", weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });
  return `${ny} New York time (${now.toISOString()})`;
}
