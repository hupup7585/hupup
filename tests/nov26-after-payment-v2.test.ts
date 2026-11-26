import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * After-payment order v2 (Hark for Abraham, Nov 26, 2026, 3:56 PM ET, exact words), on the after-payment harness.
 * Earlier note: After-payment ending (Abraham, Nov 26, 2026, 09:38 to 09:45 ET, relayed by Hark): Lines 1 to 5, then Line 8, then
 * Line 7 and the call hangs up; the order number only after payment; goodbye_order no longer plays. Disconnect ending
 * (08:56 to 09:49 ET): a caller with items in the cart, silent for 3 minutes, hears the disconnect check; any key
 * returns to the same step; no key in 3 seconds = Line 7 and hang up; an empty cart keeps today's timing.
 */
const h = vi.hoisted(() => ({
  session: { callSid: "CAPAY2", fromNumber: "+18455550641", orderId: null as number | null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "checked_out", startedAt: new Date() },
  sent: [] as { to: string; body: string }[],
}));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/session", () => ({
  ensureSession: async () => h.session,
  getSession: async () => h.session,
  updateSession: async (_s: string, patch: Record<string, unknown> & { data?: Record<string, unknown> }) => Object.assign(h.session, { ...patch, data: { ...h.session.data, ...(patch.data ?? {}) } }),
}));
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));
vi.mock("@/lib/twilio-client", () => ({
  getTwilio: () => ({ messages: { create: async (p: { to: string; body: string }) => (h.sent.push({ to: p.to, body: p.body }), { sid: `SM${h.sent.length}`, status: "queued" }) } }),
}));

import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { handleVoice } from "@/lib/ivr/flow";
import { PROMPTS } from "@/lib/ivr/prompts";
import { saveSetting } from "@/lib/settings";

const CALLER = "+18455550641";
const call = (action: string, body: Record<string, string> = {}, q = "") =>
  handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: "CAPAY2", ...body }, callSid: "CAPAY2", from: CALLER });
const said = (xml: string) => [...xml.matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => m[1].replace(/&apos;/g, "'"));
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace(/^.*\/api\/voice\//, "").replace(/&amp;/g, "&");
const gather = (xml: string) => xml.match(/<Gather ([^>]*)>/)?.[1] ?? "";
let orderId = 0;
let customerId = 0;
let productId = 0;
const digits = () => String(1000 + orderId).split("").join(" ");

const LINE1 = () => `Thank you! Your payment was approved, and your booking is confirmed. Your order number is ${digits()}.`;
const LINE2 = "We will deliver on Monday, December seventh and pick up on Tuesday, December eighth.";
const LINE3 = "Please make sure your rental is ready outside for pickup by 9 AM, to ensure an on-time pickup.";
const LINE4 = "To hear it again, press star.";
const LINE5A = "We will text your confirmation to the number you are calling from. To send it to a different number, press 1.";
const LINE5B = "To receive your confirmation and order updates by text, press 1.";
// Abraham, Nov 26, 2026, 15:00 ET: the new Line 8 (no pound key)
const LINE8 = "To stay informed, join our seasonal offers by text. You will never miss a deal, a special, or a new rental, with up to 5 messages a year. To sign up, press 1. To stop, you can reply stop at any time.";
const JOINED = "You have now joined our seasonal offers! You will stay informed about new rentals and special deals. Thank you!";
const LINE7 = "We look forward serving you again. You can call us back at any time. Thank you for choosing Hup Up Attractions! Bye for now!";
const CHECK = "It sounds like we got disconnected. To continue, press any key.";

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  process.env.TWILIO_PHONE_NUMBER = "+18454157585";
  const [c] = await db.insert(schema.customers).values({ name: "Weiss, Rivka", phone: CALLER }).returning();
  customerId = c.id;
  const [o] = await db.insert(schema.orders).values({ status: "CONFIRMED", channel: "PHONE", customerId: c.id, eventDate: "2026-12-07", pickupDate: "2026-12-08", subtotalCents: 20000, totalCents: 21625, paidCents: 21625 }).returning();
  orderId = o.id;
  const [cat] = await db.insert(schema.categories).values({ name: "Jumping balloons" }).returning();
  const [p] = await db.insert(schema.products).values({ categoryId: cat.id, name: "Castle", priceCents: 15000 }).returning();
  productId = p.id;
});
beforeEach(() => {
  h.sent.length = 0;
  h.session.data = { placedOrderId: orderId };
  h.session.orderId = null;
});
const optInOrderTexts = () => db.insert(schema.smsConsents).values({ customerId, phone: CALLER, scope: "transactional", action: "opt_in", source: "phone", method: "keypad", wording: "x" });
const OFFER = "To get your confirmation and receipt by text or email, press 1.";
const HOW = "For text, press 1. For email, press 2. For both, press 3.";
const TEXTED = "We have texted you your order confirmation. To get your receipt by email, press 1.";
const WHICH = "To text it to the number you are calling from, press 1. To enter a different number, press 2.";

describe("after payment, v2: 1, 2, 3 (star), 4, 5 (no wait), 8, 7", () => {
  it("the new slots hold the exact words, each in Admin", () => {
    expect(PROMPTS.pay_confirm_offer.text).toBe(OFFER);
    expect(PROMPTS.pay_confirm_how.text).toBe(HOW);
    expect(PROMPTS.pay_texted_receipt.text).toBe(TEXTED);
    expect(PROMPTS.phonepay_approved_star.text).toBe(LINE4);
    expect(PROMPTS.pay_approved_pickup_note.text).toBe(LINE3);
    expect(PROMPTS.disconnect_goodbye.text).toBe(LINE7);
  });
  it("lines 1, 2, 3 with about 3 seconds; star replays 1 and 2; no key goes to line 4", async () => {
    const x = await call("pay-approved", {}, `o=${orderId}`);
    expect(said(x)).toEqual([LINE1(), LINE2, LINE4]);
    expect(gather(x)).toContain('timeout="3"');
    expect(redirect(x)).toBe(`pay-approved-text?o=${orderId}`);
    expect(redirect(await call("pay-approved-choice", { Digits: "*" }, `o=${orderId}`))).toBe(`pay-approved?o=${orderId}`);
  });
  it("line 4 (pickup note) then line 5 with no wait: key 1 counts while it plays; nothing pressed = straight on to Line 8", async () => {
    const x = await call("pay-approved-text", {}, `o=${orderId}`);
    expect(said(x)).toEqual([LINE3, OFFER]);
    expect(x.indexOf(LINE3)).toBeLessThan(x.indexOf("<Gather")); // the pickup note is not inside the key wait
    expect(gather(x)).toContain('timeout="1"');
    expect(redirect(x)).toBe("promo-consent");
    expect(redirect(await call("pay-approved-text-choice", {}, `o=${orderId}`))).toBe("promo-consent");
    expect(redirect(await call("pay-approved-text-choice", { Digits: "5" }, `o=${orderId}`))).toBe("promo-consent");
  });
  it("key 1 -> the sub-menu: 1 text, 2 email, 3 both; a wrong key: not valid, then the sub-menu again", async () => {
    expect(redirect(await call("pay-approved-text-choice", { Digits: "1" }, `o=${orderId}`))).toBe(`pay-confirm-how?o=${orderId}`);
    const how = await call("pay-confirm-how", {}, `o=${orderId}`);
    expect(said(how)[0]).toBe(HOW);
    expect(redirect(how)).toBe("promo-consent");
    expect(redirect(await call("pay-confirm-how-choice", { Digits: "1" }, `o=${orderId}`))).toBe(`tx-which?p=conf&o=${orderId}`);
    expect(redirect(await call("pay-confirm-how-choice", { Digits: "2" }, `o=${orderId}`))).toBe(`catalog-email?p=rcpt&o=${orderId}`);
    expect(redirect(await call("pay-confirm-how-choice", { Digits: "3" }, `o=${orderId}`))).toBe(`tx-which?p=conf&o=${orderId}`);
    const wrong = await call("pay-confirm-how-choice", { Digits: "7" }, `o=${orderId}`);
    expect(said(wrong)).toEqual(["Sorry, that is not a valid selection."]);
    expect(redirect(wrong)).toBe(`pay-confirm-how?o=${orderId}`);
  });
  it("text: the existing which-number line; the number calling gets the confirmation; then Line 8", async () => {
    await call("pay-confirm-how-choice", { Digits: "1" }, `o=${orderId}`);
    expect(said(await call("tx-which", {}, `p=conf&o=${orderId}`)).join(" ")).toContain(WHICH);
    const x = await call("tx-which-choice", { Digits: "1" }, `p=conf&o=${orderId}`);
    expect(redirect(x)).toBe("promo-consent");
    expect(h.sent.map((m) => m.to)).toEqual([CALLER]);
  });
  it("both: the text first, then the email steps for the receipt", async () => {
    await call("pay-confirm-how-choice", { Digits: "3" }, `o=${orderId}`);
    const x = await call("tx-which-choice", { Digits: "1" }, `p=conf&o=${orderId}`);
    expect(redirect(x)).toBe(`catalog-email?p=rcpt&o=${orderId}`);
  });
  it("signed up for text updates: the texted line instead (same no-wait rule); key 1 = the receipt by email", async () => {
    await optInOrderTexts();
    const x = await call("pay-approved-text", {}, `o=${orderId}`);
    expect(said(x)).toEqual([LINE3, TEXTED]);
    expect(gather(x)).toContain('timeout="1"');
    expect(redirect(x)).toBe("promo-consent");
    expect(redirect(await call("pay-approved-text-choice", { Digits: "1" }, `o=${orderId}`))).toBe(`catalog-email?p=rcpt&o=${orderId}`);
  });
  it("the old separate text line and the old box 35 line no longer play anywhere after payment", async () => {
    const all = [await call("pay-approved", {}, `o=${orderId}`), await call("pay-approved-text", {}, `o=${orderId}`)].flatMap(said);
    expect(all).not.toContain(PROMPTS.phonepay_approved_text.text);
    expect(all).not.toContain(PROMPTS.pay_approved_optin.text);
    expect(all).not.toContain(PROMPTS.box35_receipt.text);
  });
  it("Line 7 plays only after payment; before payment the goodbye is the thank-you-for-calling line, never Line 7", async () => {
    const paid = await call("goodbye");
    expect(said(paid)).toEqual([LINE7]);
    const [unpaid] = await db.insert(schema.orders).values({ status: "PENDING_PAYMENT", channel: "PHONE", customerId, eventDate: "2026-12-21", pickupDate: "2026-12-22", subtotalCents: 15000, totalCents: 16219 }).returning();
    h.session.data = { placedOrderId: unpaid.id };
    const before = await call("goodbye");
    expect(said(before)).not.toContain(LINE7);
    expect(PROMPTS.no_input_final.text).toContain("Thank you for calling Hup Up Attractions");
    expect(PROMPTS.goodbye_thanks_calling.text).toBe("Thank you for calling Hup Up Attractions");
  });
});
