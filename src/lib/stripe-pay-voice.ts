import { signingSecret } from "@/lib/secret";
import twilio from "twilio";
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { config, BUSINESS_NAME } from "@/lib/config";
import { PAYMENT_HOLD_MINUTES, getPaymentGroup, markGroupPaid, minutesFromNow, orderNumber } from "@/lib/orders";
import { RECEIPT_APPROVED, sendPhoneReceipt } from "@/lib/phone-receipt";
import { ensureGroupPriced } from "@/lib/order-pricing";
import { loadPromptOverrides, promptText, type PromptKey, type PromptOverrides } from "@/lib/ivr/prompts";
import { stripePhonePayMode, payConnector, payLast4, verifyPaySip } from "@/lib/phone-pay";
import { paymentReceivedNotices, recordPaymentResult } from "@/lib/payment-result";
import { linkHoldMinutes } from "@/lib/settings";

/**
 * The payment subaccount's side of the call (Abraham, Nov 12, 2026): Twilio <Pay> with the Stripe Pay Connector.
 * Requests come only from the payment subaccount (signature checked with TWILIO_PAY_AUTH_TOKEN in the route). The
 * card digits are collected and sent to Stripe by Twilio; we only see the masked number and keep its last 4.
 * Nothing here logs request bodies.
 */
type VR = InstanceType<typeof twilio.twiml.VoiceResponse>;
const MAX_TRIES = 3;

const voice = () => ({ voice: config.voice() as never, language: "en-US" as const });
const payUrl = (action: string, q: Record<string, string | number>) => `${config.baseUrl()}/api/pay-voice/${action}?${new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)])).toString()}`;

/** Token for the follow-up steps on this payment leg (order + the subaccount's call). */
const tok = (orderId: number, sid: string) => createHmac("sha256", signingSecret()).update(`pay-leg:${orderId}:${sid}`).digest("hex").slice(0, 32);
/** Extra check HS4: the charged amount in the result address, signed (it can't be changed on the way). */
const amountTok = (orderId: number, sid: string, cents: number) => createHmac("sha256", signingSecret()).update(`pay-amount:${orderId}:${sid}:${cents}`).digest("hex").slice(0, 32);
function tokOk(orderId: number, sid: string, t: string | null) {
  if (!t) return false;
  const a = Buffer.from(tok(orderId, sid));
  const b = Buffer.from(t);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Pay drafts are heard only on the Owner's own test calls until he approves them (live mode needs them approved). */
function line(prompts: PromptOverrides, key: PromptKey) {
  return promptText(prompts, key);
}

async function payTwiml(vr: VR, orderId: number, sid: string, tries: number, prompts: PromptOverrides) {
  const group = await getPaymentGroup(orderId);
  if (!group || group.primary.order.status !== "PENDING_PAYMENT") {
    vr.hangup();
    return vr;
  }
  const waiting = group.orders.filter((d) => d.order.status === "PENDING_PAYMENT").map((d) => d.order.id);
  await ensureGroupPriced(waiting);
  // The rentals stay held for the whole payment: every try starts a fresh hold (Abraham, Nov 12, 2026)
  await db.update(schema.orders).set({ holdExpiresAt: minutesFromNow(await linkHoldMinutes("phone")), updatedAt: new Date() }).where(inArray(schema.orders.id, waiting));
  const due = (await getPaymentGroup(orderId))!.due;
  if (due <= 0) {
    vr.hangup();
    return vr;
  }
  // Deep check M19 (Nov 27, 2026): never record card numbers. The call recording (when on) is paused before the keypad
  // card entry, like the Sola PhonePay path; no recording running = nothing to pause (the error is ignored)
  const { pauseRecording } = await import("@/lib/call-recording");
  await pauseRecording(sid).catch(() => null);
  const pay = vr.pay({
    paymentConnector: payConnector(),
    chargeAmount: (due / 100).toFixed(2),
    currency: "usd",
    input: "dtmf",
    securityCode: true,
    postalCode: "true",
    maxAttempts: 2,
    timeout: 10,
    description: `${BUSINESS_NAME} order #${orderNumber(orderId)}`,
    // Extra check HS4 (Nov 27, 2026): the amount charged goes with the result (signed), so that amount is what is recorded
    action: payUrl("result", { o: orderId, n: tries, t: tok(orderId, sid), c: due, cs: amountTok(orderId, sid, due) }),
  });
  pay.prompt({ for: "payment-card-number" }).say(voice(), line(prompts, "pay_card_number"));
  pay.prompt({ for: "expiration-date" }).say(voice(), line(prompts, "pay_expiration"));
  pay.prompt({ for: "security-code" }).say(voice(), line(prompts, "pay_security_code"));
  pay.prompt({ for: "postal-code" }).say(voice(), line(prompts, "pay_postal_code"));
  pay.prompt({ for: "payment-processing" }).say(voice(), line(prompts, "pay_processing"));
  return vr;
}

export async function handlePayVoice(action: string, query: URLSearchParams, body: Record<string, string>): Promise<string> {
  const vr = new twilio.twiml.VoiceResponse();
  const prompts = await loadPromptOverrides();
  const sid = body.CallSid ?? "";
  // Sola PhonePay (Abraham, Nov 14, 2026): a signed hand-over from the hotline is dialed straight to PhonePay with the
  // digits from Admin. The PIN comes only from SOLA_PHONEPAY_PIN and is never logged. If PhonePay doesn't answer, the
  // backup number is tried once; then the call ends here and the caller is back on the hotline (payment link).
  if (body["SipHeader_X-Hup-Mode"] === "phonepay" || action === "phonepay-backup") {
    if (process.env.TWILIO_PAY_ACCOUNT_SID && body.AccountSid !== process.env.TWILIO_PAY_ACCOUNT_SID) {
      vr.hangup();
      return vr.toString();
    }
    const { buildSendDigits, phonePayDialTwiml, verifyPhonePaySip } = await import("@/lib/sola-phonepay");
    const { getSettings } = await import("@/lib/settings");
    const s = await getSettings();
    const pin = process.env.SOLA_PHONEPAY_PIN ?? "";
    if (action === "phonepay-backup") {
      const o = Number(query.get("o") || 0);
      const cents = Number(query.get("c"));
      const custom = query.get("k") === "custom";
      const answered = body.DialCallStatus === "completed" || body.DialCallStatus === "answered";
      if (answered || (!o && !custom) || !cents || !tokOk(o, sid, query.get("t")) || !pin) {
        vr.hangup();
        return vr.toString();
      }
      phonePayDialTwiml(vr, s.solaPhonePayBackup, buildSendDigits(custom ? s.solaPhonePayCustomDigits : s.solaPhonePayDigits, { pin, amountCents: cents, orderNumber: o ? orderNumber(o) : "" }), null);
      vr.hangup();
      return vr.toString();
    }
    const v = verifyPhonePaySip(body);
    if (!v || !s.solaPhonePayOn || !pin) {
      vr.hangup();
      return vr.toString();
    }
    // Remember this leg on the try, so the hotline can hang it up for sure (Abraham, Nov 15, 2026)
    if (sid) {
      const { and, desc, eq, isNull } = await import("drizzle-orm");
      const [open] = await db
        .select({ id: schema.phonepayAttempts.id })
        .from(schema.phonepayAttempts)
        .where(and(eq(schema.phonepayAttempts.callSid, v.mainCallSid), isNull(schema.phonepayAttempts.endedAt)))
        .orderBy(desc(schema.phonepayAttempts.id))
        .limit(1);
      if (open) await db.update(schema.phonepayAttempts).set({ payLegSid: sid }).where(eq(schema.phonepayAttempts.id, open.id));
    }
    const custom = v.kind === "custom";
    const digits = buildSendDigits(custom ? s.solaPhonePayCustomDigits : s.solaPhonePayDigits, { pin, amountCents: v.cents, orderNumber: v.orderId ? orderNumber(v.orderId) : "" });
    phonePayDialTwiml(vr, s.solaPhonePayNumber, digits, payUrl("phonepay-backup", { o: v.orderId, c: v.cents, k: v.kind, t: tok(v.orderId, sid) }));
    return vr.toString();
  }
  const { getSettings } = await import("@/lib/settings");
  if (stripePhonePayMode(process.env, await getSettings()) === "off" || (process.env.TWILIO_PAY_ACCOUNT_SID && body.AccountSid !== process.env.TWILIO_PAY_ACCOUNT_SID)) {
    vr.hangup();
    return vr.toString();
  }

  if (action === "incoming") {
    // The hotline handed the call over with the order in signed SIP headers
    const v = verifyPaySip(body);
    if (!v) {
      vr.hangup();
      return vr.toString();
    }
    return (await payTwiml(vr, v.orderId, sid, 1, prompts)).toString();
  }

  const orderId = Number(query.get("o"));
  if (!orderId || !tokOk(orderId, sid, query.get("t"))) {
    vr.hangup();
    return vr.toString();
  }
  const tries = Number(query.get("n") || 1);

  if (action === "result") {
    const result = body.Result ?? "";
    const last4 = payLast4(body.PaymentCardNumber);
    const group = await getPaymentGroup(orderId);
    const ids = group?.orders.map((d) => d.order.id) ?? [orderId];
    if (result === "success" && body.PaymentConfirmationCode) {
      const code = body.PaymentConfirmationCode;
      // Duplicate protection: claim the payment ID first, in one atomic update. A repeated result (or two arriving at
      // the same moment) finds it already claimed, so the order is never marked paid twice.
      const claimed = group
        ? await db.update(schema.orders).set({ stripePaymentId: code }).where(and(inArray(schema.orders.id, ids), isNull(schema.orders.stripePaymentId))).returning({ id: schema.orders.id })
        : [];
      if (claimed.length && group) {
        // the amount charged (signed with the result address); the amount due now only when the address has none
        const charged = Number(query.get("c"));
        const cents = Number.isInteger(charged) && charged > 0 && amountTok(orderId, sid, charged) === query.get("cs") ? charged : group.due;
        await markGroupPaid(orderId, cents, "stripe", null);
        await recordPaymentResult(ids, "approved", last4, code);
        // Abraham: once approved, the receipt replaces the short "payment received" email (not both)
        await paymentReceivedNotices(orderId, cents, { skipCustomerEmail: RECEIPT_APPROVED && Boolean(group.primary.customer?.email) });
        // Our own receipt from info@ (draft: sent once Abraham approves the wording)
        // A late payment whose items were taken gets the "please call us" email instead of a receipt
        const after = await getPaymentGroup(orderId);
        if (!after?.orders.some((d) => d.order.status === "NEEDS_ATTENTION"))
          await sendPhoneReceipt(group.primary.customer?.email, { orderId, paidAt: new Date(), amountCents: cents, last4, name: group.primary.customer?.name }).catch(() => null);
      }
      vr.say(voice(), line(prompts, "pay_success"));
      vr.hangup(); // back to the hotline call, which carries on
      return vr.toString();
    }
    if (result === "caller-hung-up") return vr.toString();
    // Declined or not completed: recorded (with last 4 when there was a card), then try again or get the link
    if (body.PaymentError || result === "payment-connector-error" || last4) await recordPaymentResult(ids, "declined", last4, null);
    if (tries >= MAX_TRIES) {
      vr.hangup(); // the hotline emails the payment link
      return vr.toString();
    }
    const g = vr.gather({ input: ["dtmf"], numDigits: 1, timeout: 8, action: payUrl("retry", { o: orderId, n: tries, t: tok(orderId, sid) }), method: "POST" });
    g.say(voice(), line(prompts, "pay_declined"));
    vr.hangup();
    return vr.toString();
  }

  if (action === "retry") {
    if (body.Digits === "1") {
      // Deep check Nov 27 (item 27): no new card try once the Shabbes / Yom Tov cut-off has started (back to the
      // hotline call, which plays its cut-off)
      const { bookingCutoff } = await import("@/lib/jewish-calendar");
      const { calendarNow } = await import("@/lib/clock");
      const st = await (await import("@/lib/settings")).getSettings();
      if (bookingCutoff(calendarNow(), st as never, Number(st.phoneCutoffMinutes ?? 15)).cut) {
        vr.hangup();
        return vr.toString();
      }
      return (await payTwiml(vr, orderId, sid, tries + 1, prompts)).toString();
    }
    vr.hangup(); // 2, or no key: the hotline emails the payment link
    return vr.toString();
  }

  vr.hangup();
  return vr.toString();
}

/** For tests: the follow-up token. */
export const _payLegToken = tok;

