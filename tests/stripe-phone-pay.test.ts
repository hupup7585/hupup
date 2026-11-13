import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Pay by keypad through Stripe (Abraham, Nov 12, 2026): the hotline hands the call to the payment subaccount by SIP;
 * Twilio <Pay> + the Stripe connector charge the order total; the result marks the order. Simulated on an in-memory
 * database; nothing is dialed or charged.
 */
const h = vi.hoisted(() => ({
  session: { callSid: "CAmain", fromNumber: "+18457777585", orderId: null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing" },
  emails: [] as { to: string; subject: string; text: string }[],
}));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/session", () => ({
  ensureSession: async () => h.session,
  getSession: async () => h.session,
  updateSession: async (_sid: string, patch: Record<string, unknown> & { data?: Record<string, unknown> }) => Object.assign(h.session, patch, patch.data ? { data: { ...h.session.data, ...patch.data } } : {}),
}));
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));
vi.mock("@/lib/notify", async (orig) => ({
  ...(await orig<typeof import("@/lib/notify")>()),
  sendSms: async () => ({ sent: false }),
  sendEmail: async (to: string, subject: string, text: string) => (h.emails.push({ to, subject, text }), { sent: true }),
}));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { handleVoice } from "@/lib/ivr/flow";
import { handlePayVoice, _payLegToken } from "@/lib/stripe-pay-voice";
import { keypadPayFor, payLast4, paySipUri, verifyPaySip } from "@/lib/phone-pay";

const ENV = {
  TWILIO_PAY_ACCOUNT_SID: "ACpay",
  TWILIO_PAY_AUTH_TOKEN: "pay-token",
  TWILIO_PAY_SIP_DOMAIN: "hupup-pay.sip.twilio.com",
  TWILIO_PAY_SIP_USERNAME: "hotline",
  TWILIO_PAY_SIP_PASSWORD: "pw",
};
const mainCall = (action: string, body: Record<string, string> = {}, q = "") =>
  handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: "CAmain", ...body }, callSid: "CAmain", from: h.session.fromNumber });
const sipHeaders = (uri: string) => Object.fromEntries([...new URL(uri.replace("sip:", "https://")).searchParams].map(([k, v]) => [`SipHeader_${k}`, v]));
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace(/^.*\/api\/voice\//, "").replace(/&amp;/g, "&");
const order = async (id: number) => (await db.select().from(schema.orders).where(eq(schema.orders.id, id)))[0];

let orderId = 0;
async function newOrder() {
  const [c] = await db.insert(schema.customers).values({ name: "Test Caller", phone: "+18457777585", email: "caller@example.com" }).returning();
  const [o] = await db
    .insert(schema.orders)
    .values({ status: "PENDING_PAYMENT", channel: "PHONE", customerId: c.id, eventDate: "2026-12-15", pickupDate: "2026-12-16", deliveryAddress: "12 Forest Road, Monroe", subtotalCents: 20000, deliveryZone: "area", deliveryFeeCents: 1500, taxPercent: "8.125", taxCents: 1747, totalCents: 23247 })
    .returning();
  return o.id;
}

beforeAll(() => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  process.env.AUTH_SECRET = "test-secret";
  process.env.ADMIN_PHONE = "+18457777585";
  Object.assign(process.env, ENV);
});
beforeEach(async () => {
  h.emails.length = 0;
  h.session.data = { email: "caller@example.com" };
  orderId = await newOrder();
});

describe("who gets keypad payment", () => {
  it("owner test calls only, and only once the payment subaccount is set up in Vercel", () => {
    expect(keypadPayFor("+18457777585", "owner_test", ENV)).toBe(true);
    expect(keypadPayFor("+18455550199", "owner_test", ENV)).toBe(false);
    expect(keypadPayFor("+18457777585", "owner_test", {})).toBe(false);
    expect(keypadPayFor("+18455550199", "off", ENV)).toBe(false);
  });
});

describe("the hotline hands the call to the payment subaccount", () => {
  it("dials the subaccount's SIP domain with the order in signed headers; the main account never runs <Pay>", async () => {
    const xml = await mainCall("pay-keypad", {}, `o=${orderId}`);
    expect(xml).toContain("hupup-pay.sip.twilio.com");
    expect(xml).toContain(`X-Hup-Order=${orderId}`);
    expect(xml).toMatch(/<Sip username="hotline" password="pw">/);
    expect(xml).not.toContain("<Pay");
    const v = verifyPaySip(sipHeaders(paySipUri(orderId, "CAmain")));
    expect(v).toEqual({ orderId, mainCallSid: "CAmain" });
    expect(verifyPaySip({ ...sipHeaders(paySipUri(orderId, "CAmain")), "SipHeader_X-Hup-Order": String(orderId + 1) })).toBeNull(); // tampered
  });
});

describe("the payment subaccount: Twilio <Pay> through Stripe", () => {
  const sub = (action: string, body: Record<string, string>, q = "") => handlePayVoice(action, new URLSearchParams(q), { AccountSid: "ACpay", CallSid: "CApay", ...body });
  it("charges the order total (items + delivery + tax) through the Stripe connector, card by keypad with security code and ZIP", async () => {
    const xml = await sub("incoming", sipHeaders(paySipUri(orderId, "CAmain")));
    expect(xml).toMatch(/<Pay [^>]*paymentConnector="Stripe_Connector"/);
    expect(xml).toMatch(/chargeAmount="232.47"/);
    expect(xml).toMatch(/securityCode="true"/);
    expect(xml).toMatch(/postalCode="true"/);
    expect(xml).toMatch(/input="dtmf"/);
    expect(xml).toContain('<Prompt for="payment-card-number">');
  });
  it("the rentals stay held for the whole payment: each try starts a fresh hold", async () => {
    await db.update(schema.orders).set({ holdExpiresAt: new Date(Date.now() + 60_000) }).where(eq(schema.orders.id, orderId));
    await sub("incoming", sipHeaders(paySipUri(orderId, "CAmain")));
    const o = await order(orderId);
    expect(o.holdExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 9 * 60_000); // 10 minutes (Abraham)
  });
  it("refuses requests from another account or without valid signed headers", async () => {
    expect(await handlePayVoice("incoming", new URLSearchParams(), { AccountSid: "ACother", CallSid: "x", ...sipHeaders(paySipUri(orderId, "CAmain")) })).toContain("<Hangup/>");
    expect(await sub("incoming", { "SipHeader_X-Hup-Order": String(orderId) })).toContain("<Hangup/>");
    expect(await sub("result", { Result: "success", PaymentConfirmationCode: "ch_fake" }, `o=${orderId}&n=1&t=bad`)).toContain("<Hangup/>");
    expect((await order(orderId)).status).toBe("PENDING_PAYMENT");
  });
  it("approved: 'Payment received, thank you!', order Paid with the Stripe payment ID, time and last 4 only", async () => {
    const xml = await sub("result", { Result: "success", PaymentConfirmationCode: "ch_3Test123", PaymentCardNumber: "xxxx-xxxx-xxxx-4242", PaymentCardType: "visa" }, `o=${orderId}&n=1&t=${_payLegToken(orderId, "CApay")}`);
    expect(xml).toContain("Payment received, thank you!");
    const o = await order(orderId);
    expect(o.status).toBe("CONFIRMED");
    expect(o.paidCents).toBe(23247);
    expect(o.paymentMethod).toBe("stripe");
    expect(o.stripePaymentId).toBe("ch_3Test123");
    expect(o.paymentResult).toBe("approved");
    expect(o.cardLast4).toBe("4242");
    expect(JSON.stringify(o)).not.toContain("xxxx-xxxx");
    // The approved receipt replaces the short "payment received" email (Abraham, Nov 13, 2026)
    const toCaller = h.emails.filter((e) => e.to === "caller@example.com");
    expect(toCaller.map((e) => e.subject)).toEqual([`Hup Up Attractions receipt for order #${1000 + orderId}`]);
    expect(toCaller[0].text).toContain("Card: ending in 4242");
    // the hotline carries on without a payment link
    const back = await mainCall("pay-done", {}, `o=${orderId}`);
    expect(redirect(back)).toBe("promo-consent");
    expect(h.emails.filter((e) => e.text.includes("Pay securely"))).toHaveLength(0);
    // Duplicate protection: the same result twice at the same moment never pays or emails twice
    const again = { Result: "success", PaymentConfirmationCode: "ch_3Test123", PaymentCardNumber: "xxxx-xxxx-xxxx-4242", PaymentCardType: "visa" };
    const q = `o=${orderId}&n=1&t=${_payLegToken(orderId, "CApay")}`;
    await Promise.all([sub("result", again, q), sub("result", again, q)]);
    expect((await order(orderId)).paidCents).toBe(23247);
    expect(h.emails.filter((e) => e.to === "caller@example.com")).toHaveLength(1);
  });
  it("declined: recorded with last 4, then 1 tries again or 2 gets the Sola link by email", async () => {
    const t = _payLegToken(orderId, "CApay");
    const xml = await sub("result", { Result: "payment-connector-error", PaymentError: "card_declined", PaymentCardNumber: "xxxx-xxxx-xxxx-0002" }, `o=${orderId}&n=1&t=${t}`);
    expect(xml).toContain("Sorry, that card didn't go through. To try again, press 1. To get a secure payment link by email instead, press 2.");
    const o = await order(orderId);
    expect([o.paymentResult, o.cardLast4, o.status]).toEqual(["declined", "0002", "PENDING_PAYMENT"]);
    expect(await sub("retry", { Digits: "1" }, `o=${orderId}&n=1&t=${t}`)).toContain("<Pay ");
    expect(await sub("retry", { Digits: "2" }, `o=${orderId}&n=1&t=${t}`)).toContain("<Hangup/>");
    // back on the hotline: the Sola link is emailed (items + delivery + tax)
    const back = await mainCall("pay-done", {}, `o=${orderId}`);
    expect(redirect(back)).toBe("promo-consent");
    const mail = h.emails.find((e) => e.to === "caller@example.com");
    expect(mail?.text).toContain("total $232.47");
    expect(mail?.text).toContain("/pay/");
  });
  it("after 3 tries no more retries: the hotline sends the link", async () => {
    expect(await sub("result", { Result: "too-many-failed-attempts" }, `o=${orderId}&n=3&t=${_payLegToken(orderId, "CApay")}`)).toBe('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
  });
  it("last 4 only, from Twilio's masked number", () => {
    expect(payLast4("xxxx-xxxx-xxxx-4242")).toBe("4242");
    expect(payLast4("")).toBeNull();
  });
});
