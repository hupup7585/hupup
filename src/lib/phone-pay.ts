import { createHmac, timingSafeEqual } from "node:crypto";
import { toE164 } from "@/lib/phone";

/**
 * Pay by keypad during the call, through Stripe (Abraham, Nov 12, 2026). Sola stays for website payments.
 *
 * How it works:
 *  - After the full order read-back, the main hotline call is passed (Dial to a SIP domain) to a separate Twilio
 *    subaccount used only for payments, with PCI mode on there and the Stripe Pay Connector installed. The main
 *    account and its logs stay as they are; PCI mode is never turned on there.
 *  - In the subaccount, Twilio <Pay> collects card number, expiration, security code and billing ZIP by keypad and
 *    charges the order total (items + delivery + tax) through Stripe. The card digits stay inside Twilio Pay: our
 *    server only ever receives Twilio's masked number, and only its last 4 digits are kept.
 *  - The result posts back to /api/pay-voice: Paid or Declined on the order with date and time, the Stripe payment ID
 *    and last 4. When the payment leg ends, the main call continues; if the order isn't paid, the Sola payment link
 *    is emailed instead (texted too once Twilio approves texting).
 *
 * Who hears it: STRIPE_PHONE_PAY_MODE. "owner_test" = only calls from the Owner's own phone (ADMIN_PHONE), for
 * Abraham's Stripe test-mode call; every other caller gets the payment link as before. "live" only after Abraham
 * approves a real test and the pay prompts. It also needs the subaccount settings below in Vercel.
 *
 * Vercel variables the code reads (Abraham/Hark add the values; never in chat):
 *   TWILIO_PAY_ACCOUNT_SID   the payment subaccount's Account SID
 *   TWILIO_PAY_AUTH_TOKEN    the payment subaccount's Auth Token (checks that requests really come from it)
 *   TWILIO_PAY_SIP_DOMAIN    the subaccount's SIP domain, e.g. hupup-pay.sip.twilio.com
 *   TWILIO_PAY_SIP_USERNAME  a credential on that SIP domain's credential list
 *   TWILIO_PAY_SIP_PASSWORD  its password
 *   TWILIO_PAY_CONNECTOR     the Stripe Pay Connector's unique name in the subaccount (default "Stripe_Connector")
 * The Stripe keys are connected inside Twilio's Stripe Pay Connector; this code doesn't read them.
 */
export type PhonePayMode = "off" | "owner_test" | "live";
export const STRIPE_PHONE_PAY_MODE: PhonePayMode = "owner_test";

export const PAY_ENV_NAMES = ["TWILIO_PAY_ACCOUNT_SID", "TWILIO_PAY_AUTH_TOKEN", "TWILIO_PAY_SIP_DOMAIN", "TWILIO_PAY_SIP_USERNAME", "TWILIO_PAY_SIP_PASSWORD"] as const;

export function phonePayConfigured(env: Record<string, string | undefined> = process.env) {
  return PAY_ENV_NAMES.every((k) => Boolean(env[k]));
}

/** Does this caller get keypad payment right after the read-back? */
export function keypadPayFor(callerFrom: string | null | undefined, mode: PhonePayMode = STRIPE_PHONE_PAY_MODE, env: Record<string, string | undefined> = process.env): boolean {
  if (mode === "off" || !phonePayConfigured(env)) return false;
  if (mode === "live") return true;
  const caller = toE164(callerFrom);
  return Boolean(caller && caller === (toE164(env.ADMIN_PHONE) ?? "+18457777585"));
}

/** Older name kept for the read-back step. */
export function keypadPayOn() {
  return STRIPE_PHONE_PAY_MODE === "live" && phonePayConfigured();
}

export const payConnector = (env: Record<string, string | undefined> = process.env) => env.TWILIO_PAY_CONNECTOR || "Stripe_Connector";

/** The order travels to the subaccount in SIP headers, signed so it can't be changed on the way. */
const sigFor = (orderId: number, callSid: string) => createHmac("sha256", process.env.AUTH_SECRET || "dev-secret").update(`phone-pay:${orderId}:${callSid}`).digest("hex").slice(0, 32);

export function paySipUri(orderId: number, callSid: string, env: Record<string, string | undefined> = process.env): string {
  return `sip:pay@${env.TWILIO_PAY_SIP_DOMAIN}?X-Hup-Order=${orderId}&X-Hup-Call=${encodeURIComponent(callSid)}&X-Hup-Sig=${sigFor(orderId, callSid)}`;
}

export function verifyPaySip(body: Record<string, string>): { orderId: number; mainCallSid: string } | null {
  const orderId = Number(body["SipHeader_X-Hup-Order"]);
  const mainCallSid = body["SipHeader_X-Hup-Call"] ?? "";
  const sig = body["SipHeader_X-Hup-Sig"] ?? "";
  if (!Number.isInteger(orderId) || orderId <= 0 || !mainCallSid || !sig) return null;
  const want = Buffer.from(sigFor(orderId, mainCallSid));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got) ? { orderId, mainCallSid } : null;
}

/** Last 4 digits from Twilio's masked card number (e.g. "xxxx-xxxx-xxxx-1111"); never anything more. */
export function payLast4(masked: string | null | undefined): string | null {
  const m = /(\d{4})\D*$/.exec(masked ?? "");
  return m ? m[1] : null;
}

/** For Admin: Off / Owner test / Live, whether the subaccount is set up, and Stripe test or live mode (from the key). */
export function phonePayStatus(env: Record<string, string | undefined> = process.env, mode: PhonePayMode = STRIPE_PHONE_PAY_MODE) {
  const k = env.STRIPE_READ_KEY || env.STRIPE_WRITE_KEY || "";
  const stripe = /^(rk|sk)_test_/.test(k) ? "Stripe test mode" : /^(rk|sk)_live_/.test(k) ? "Stripe live mode" : "Stripe keys not in Vercel yet";
  const missing = PAY_ENV_NAMES.filter((n) => !env[n]);
  return {
    mode: mode === "off" ? "Off" : mode === "owner_test" ? "Owner test" : "Live",
    configured: missing.length === 0,
    missing,
    stripe,
  };
}
