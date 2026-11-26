import { PHONE_PROMO_MODE } from "@/lib/phone-promo";
import { JOIN_INVITE_ON } from "@/lib/join-invite";
import { stripePhonePayMode } from "@/lib/phone-pay";
import { LIVE_REFUNDS_APPROVED } from "@/lib/refunds";
import { CALL_OUT_LIVE_APPROVED, VM_ACCESS_LIVE_APPROVED } from "@/lib/vm-access";
import { MESSAGE_DUAL_DATES } from "@/lib/dual-date";
import { STAFF_PROMO_MODE } from "@/lib/staff-promo";
import { PAY_DATES_LIVE } from "@/lib/ivr/flow";
import { STT_LIVE_APPROVED } from "@/lib/speech-to-text";
import { RECEIPT_APPROVED } from "@/lib/phone-receipt";
import { INVOICE_EMAIL_APPROVED } from "@/lib/invoice-share";
import { LATE_EMAIL_APPROVED, LINK_WORDING_APPROVED, OPTIONS_WORDING_APPROVED } from "@/lib/late-payment";
import { SMS_CATALOG_REPLY_ON } from "@/lib/catalog-send";
import { WEBSITE_CATALOG_FORM_LIVE_APPROVED } from "@/lib/catalog-request";
import { NEW_EMAIL_LIVE } from "@/lib/config";
import { SETTING_DEFAULTS } from "@/lib/settings";

/**
 * Feature switch registry (Admin handoff item 74, Nov 26, 2026; completed after Hark's review M10): every held,
 * preview, on or off feature, its real state now (read from the same place the feature reads it), in plain words, and
 * what it waits for. Ones set in code say "Needs Claude to connect"; ones that are Admin settings link to them. None is
 * switched on by being listed.
 */
export type FeatureSwitch = { id: string; label: string; state: string; waitsFor: string; settingKey?: string };
const onOff = (b: boolean) => (b ? "On" : "Off");
/** Plain words for the modes kept in code (no code words on the page). */
export const MODE_WORDS: Record<string, string> = { off: "Off", owner_preview: "Owner preview only", owner_test: "Owner test numbers only", preview: "Preview only", live: "On", on: "On" };
const mode = (m: string) => MODE_WORDS[m] ?? m;

export function featureSwitches(settings: Record<string, unknown> = SETTING_DEFAULTS as Record<string, unknown>): FeatureSwitch[] {
  const yes = (k: string) => onOff(Boolean(settings[k]));
  return [
    { id: "join_invite", label: "JOIN by text invitation", state: onOff(JOIN_INVITE_ON), waitsFor: "Abraham's OK (stays off)" },
    { id: "phone_promo_old", label: "Old three-step promo sign-up on the phone", state: mode(PHONE_PROMO_MODE), waitsFor: "Replaced by the paid-order question" },
    { id: "stripe_phone_pay", label: "Stripe card payment on the phone", state: mode(stripePhonePayMode(process.env, { phoneCardProvider: String(settings.phoneCardProvider ?? "sola") })), waitsFor: "Provider setup, a real test call and Abraham's OK for live" },
    { id: "live_refunds", label: "Live refunds", state: onOff(LIVE_REFUNDS_APPROVED), waitsFor: "Provider setup, test results and Abraham's OK" },
    { id: "vm_call_out", label: "Calling a customer back from the voicemail menu", state: onOff(CALL_OUT_LIVE_APPROVED), waitsFor: "Abraham's OK on the price" },
    { id: "vm_access", label: "Staff voicemail by phone", state: onOff(VM_ACCESS_LIVE_APPROVED), waitsFor: "Approved" },
    { id: "hebrew_dates", label: "Hebrew dates in messages", state: onOff(MESSAGE_DUAL_DATES), waitsFor: "Abraham's OK (stays off)" },
    { id: "staff_promo", label: "Staff promo sign-up box", state: mode(STAFF_PROMO_MODE), waitsFor: "Abraham's OK" },
    { id: "pay_dates", label: "After payment: the delivery and pickup dates line", state: onOff(PAY_DATES_LIVE), waitsFor: "Approved Nov 26, 2026" },
    { id: "directory_lookup", label: "Caller lookup in the directory", state: "Preview only", waitsFor: "Abraham's OK on its lines" },
    { id: "speech_to_text", label: "Speech to text for spoken answers", state: onOff(STT_LIVE_APPROVED), waitsFor: "Approved Nov 17, 2026" },
    { id: "phone_receipt", label: "Receipt email after a phone payment", state: onOff(RECEIPT_APPROVED), waitsFor: "Approved Nov 13, 2026" },
    { id: "invoice_email", label: "Invoice by email", state: onOff(INVOICE_EMAIL_APPROVED), waitsFor: "Approved" },
    { id: "link_wording", label: "Payment link page wording", state: onOff(LINK_WORDING_APPROVED), waitsFor: "Approved Nov 13, 2026" },
    { id: "options_wording", label: "Payment link: nearest options list", state: onOff(OPTIONS_WORDING_APPROVED), waitsFor: "Approved" },
    { id: "late_email", label: "Late payment email", state: onOff(LATE_EMAIL_APPROVED), waitsFor: "Approved Nov 13, 2026" },
    { id: "sms_catalog_reply", label: "Catalog reply to a CATALOG text", state: onOff(SMS_CATALOG_REPLY_ON), waitsFor: "On since Nov 16, 2026" },
    { id: "website_catalog_form", label: "Website catalog request card", state: onOff(WEBSITE_CATALOG_FORM_LIVE_APPROVED), waitsFor: "Approved Nov 19, 2026" },
    { id: "new_email", label: "Public email is info@hupupattractions.com", state: onOff(NEW_EMAIL_LIVE), waitsFor: "Approved Nov 10, 2026" },
    // Admin settings (links to their page through All settings)
    { id: "call_recording", label: "Call recording", state: yes("callRecording"), waitsFor: "Abraham's OK on the recording notice", settingKey: "callRecording" },
    { id: "google_voice", label: "Google voice for the changing parts (paid)", state: yes("googleLiveVoice"), waitsFor: "Costs money: stays off", settingKey: "googleLiveVoice" },
    { id: "sola_phonepay", label: "Card payment by phone (Sola)", state: yes("solaPhonePayOn"), waitsFor: "", settingKey: "solaPhonePayOn" },
    { id: "sola_listen", label: "Sola listening helper", state: yes("solaListenOn"), waitsFor: "A passed test call", settingKey: "solaListenOn" },
    { id: "delivery_promo", label: "Free delivery offer", state: yes("deliveryPromoOn"), waitsFor: "", settingKey: "deliveryPromoOn" },
    { id: "achird_whole_line", label: "Whole lines from recorded pieces", state: yes("achirdWholeLine"), waitsFor: "", settingKey: "achirdWholeLine" },
    { id: "laser_half", label: "Laser tag: every third set half price", state: yes("laserThirdSetHalfOn"), waitsFor: "", settingKey: "laserThirdSetHalfOn" },
    { id: "offer_thu_sun", label: "Offer: Thursday to Sunday", state: yes("offerThuSunOn"), waitsFor: "", settingKey: "offerThuSunOn" },
    { id: "offer_4th_sunday", label: "Offer: 4th Sunday free", state: yes("offerFourthSundayOn"), waitsFor: "", settingKey: "offerFourthSundayOn" },
    { id: "sms_test_only", label: "Texts to test numbers only", state: yes("smsTestOnly"), waitsFor: "", settingKey: "smsTestOnly" },
  ];
}

/** The list with the default settings (kept for older code and tests); the page reads featureSwitches(live settings). */
export const FEATURE_SWITCHES: FeatureSwitch[] = featureSwitches();
