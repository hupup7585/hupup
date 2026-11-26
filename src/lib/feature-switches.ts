import { PHONE_PROMO_MODE } from "@/lib/phone-promo";
import { JOIN_INVITE_ON } from "@/lib/join-invite";
import { STRIPE_PHONE_PAY_MODE } from "@/lib/phone-pay";
import { LIVE_REFUNDS_APPROVED } from "@/lib/refunds";
import { CALL_OUT_LIVE_APPROVED } from "@/lib/vm-access";
import { MESSAGE_DUAL_DATES } from "@/lib/dual-date";
import { STAFF_PROMO_MODE } from "@/lib/staff-promo";
import { PAY_DATES_LIVE } from "@/lib/ivr/flow";

/**
 * Feature switch registry (Admin handoff item 74, Nov 26, 2026): every held, preview or off feature, its state now,
 * and what it waits for. Ones still set in code say "Needs Claude to connect"; none is switched on by being listed.
 */
export type FeatureSwitch = { id: string; label: string; state: string; waitsFor: string; settingKey?: string };
const onOff = (b: boolean) => (b ? "On" : "Off");

export const FEATURE_SWITCHES: FeatureSwitch[] = [
  { id: "join_invite", label: "JOIN by text invitation", state: onOff(JOIN_INVITE_ON), waitsFor: "Abraham's OK (stays off)" },
  { id: "phone_promo_old", label: "Old three-step promo sign-up on the phone", state: PHONE_PROMO_MODE, waitsFor: "Replaced by the paid-order question (live)" },
  { id: "stripe_phone_pay", label: "Stripe card payment on the phone", state: STRIPE_PHONE_PAY_MODE, waitsFor: "Provider setup, a real test call and Abraham's OK" },
  { id: "live_refunds", label: "Live refunds", state: onOff(LIVE_REFUNDS_APPROVED), waitsFor: "Provider setup, test results and Abraham's OK" },
  { id: "vm_call_out", label: "Voicemail call-out", state: onOff(CALL_OUT_LIVE_APPROVED), waitsFor: "Abraham's OK on the price" },
  { id: "hebrew_dates", label: "Hebrew dates in messages", state: onOff(MESSAGE_DUAL_DATES), waitsFor: "Abraham's OK (stays off)" },
  { id: "staff_promo", label: "Staff promo sign-up box", state: STAFF_PROMO_MODE, waitsFor: "Abraham's OK" },
  { id: "pay_dates", label: "Box 148 dates line", state: onOff(PAY_DATES_LIVE), waitsFor: "Approved Nov 26, 2026" },
  { id: "directory_lookup", label: "Caller lookup in the directory", state: "Preview only", waitsFor: "Abraham's OK on its lines" },
  { id: "laser_half", label: "Laser tag: every third set half price", state: "Setting", waitsFor: "", settingKey: "laserThirdSetHalfOn" },
  { id: "offer_thu_sun", label: "Offer: Thursday to Sunday", state: "Setting", waitsFor: "", settingKey: "offerThuSunOn" },
  { id: "offer_4th_sunday", label: "Offer: 4th Sunday free", state: "Setting", waitsFor: "", settingKey: "offerFourthSundayOn" },
  { id: "sms_test_only", label: "Texts to test numbers only", state: "Setting", waitsFor: "", settingKey: "smsTestOnly" },
];
