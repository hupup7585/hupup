import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * After-payment ending (Abraham, Nov 26, 2026, 09:38 to 09:45 ET, relayed by Hark): Lines 1 to 5, then Line 8, then
 * Line 7 and the call hangs up; the order number only after payment; goodbye_order no longer plays. Disconnect ending
 * (08:56 to 09:49 ET): a caller with items in the cart, silent for 3 minutes, hears the disconnect check; any key
 * returns to the same step; no key in 3 seconds = Line 7 and hang up; an empty cart keeps today's timing.
 */
const h = vi.hoisted(() => ({
  session: { callSid: "CAPAY", fromNumber: "+18455550601", orderId: null as number | null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "checked_out", startedAt: new Date() },
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

const CALLER = "+18455550601";
const call = (action: string, body: Record<string, string> = {}, q = "") =>
  handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: "CAPAY", ...body }, callSid: "CAPAY", from: CALLER });
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
const LINE8 = "Would you like to receive our seasonal offers by text? You will get up to 5 messages a year. To sign up, press 1. To skip, press pound.";
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

describe("the approved words (Admin slots, word for word, no contractions)", () => {
  it("Lines 1 to 8 and the disconnect check", () => {
    expect(PROMPTS.phonepay_approved.text).toBe("Thank you! Your payment was approved, and your booking is confirmed. Your order number is {number}.");
    expect(PROMPTS.pay_approved_dates.text).toBe("We will deliver on {date} and pick up on {pickup}.");
    expect(PROMPTS.pay_approved_pickup_note.text).toBe(LINE3);
    expect(PROMPTS.phonepay_approved_star.text).toBe(LINE4);
    expect(PROMPTS.phonepay_approved_text.text).toBe(LINE5A);
    expect(PROMPTS.pay_approved_optin.text).toBe(LINE5B);
    expect(PROMPTS.paid_promo_offer.text).toBe(LINE8);
    expect(PROMPTS.disconnect_goodbye.text).toBe(LINE7);
    expect(PROMPTS.disconnect_goodbye.text).not.toContain("forward to"); // Abraham, 10:17 ET: no "to"
    expect(PROMPTS.disconnect_check.text).toBe(CHECK);
    for (const k of ["phonepay_approved", "pay_approved_dates", "pay_approved_pickup_note", "phonepay_approved_star", "phonepay_approved_text", "pay_approved_optin", "paid_promo_offer", "disconnect_goodbye", "disconnect_check"] as const)
      expect(PROMPTS[k].text, k).not.toMatch(/\b\w+'(s|t|re|ll|ve|d|m)\b/i);
  });
  it("Admin recording slots exist for every line, including Line 2a and 2b as the two pieces around the dates", async () => {
    const { allSlots } = await import("@/lib/recording-slots");
    const slot = new Map(allSlots().map((x) => [x.key, x.text]));
    expect(slot.get("pay_approved_dates#1")).toBe("We will deliver on");
    expect(slot.get("pay_approved_dates#2")).toBe("and pick up on");
    expect(slot.get("phonepay_approved#1")).toBe("Thank you! Your payment was approved, and your booking is confirmed. Your order number is"); // Line 1, before the spoken number
    for (const k of ["phonepay_approved_star", "phonepay_approved_text", "pay_approved_optin", "disconnect_goodbye", "disconnect_check", "paid_promo_offer", "pay_approved_pickup_note"]) expect(slot.has(k), k).toBe(true);
  });
});

describe("after payment, in order: 1, 2, 3, 4, then 5, then 8, then 7", () => {
  it("Lines 1 to 4 in one screen with about 3 seconds for a key; no key goes on to Line 5", async () => {
    const x = await call("pay-approved", {}, `o=${orderId}`);
    expect(said(x)).toEqual([LINE1(), LINE2, LINE3, LINE4]);
    expect(gather(x)).toContain('timeout="3"');
    expect(redirect(x)).toBe(`pay-approved-text?o=${orderId}`);
    expect(redirect(await call("pay-approved-choice", {}, `o=${orderId}`))).toBe(`pay-approved-text?o=${orderId}`);
  });
  it("star replays from Line 1", async () => {
    expect(redirect(await call("pay-approved-choice", { Digits: "*" }, `o=${orderId}`))).toBe(`pay-approved?o=${orderId}`);
    expect(said(await call("pay-approved", {}, `o=${orderId}`))[0]).toBe(LINE1());
  });
  it("not signed up for order texts: Line 5b; no key goes on (box 35, then Line 8)", async () => {
    const x = await call("pay-approved-text", {}, `o=${orderId}`);
    expect(said(x)).toEqual([LINE5B]);
    expect(gather(x)).toContain('timeout="3"');
    expect(redirect(x)).toBe(`receipt-email?o=${orderId}`);
    expect(redirect(await call("pay-approved-text-choice", {}, `o=${orderId}`))).toBe(`receipt-email?o=${orderId}`);
  });
  it("Line 5b, key 1: signs up the calling number and texts the confirmation", async () => {
    const r = await call("pay-approved-text-choice", { Digits: "1" }, `o=${orderId}`);
    expect(redirect(r)).toBe(`receipt-email?o=${orderId}`);
    expect(h.sent.map((m) => m.to)).toEqual([CALLER]);
    const rows = await db.select().from(schema.smsConsents).where(eq(schema.smsConsents.phone, CALLER));
    expect(rows.some((c) => c.scope === "transactional" && c.action === "opt_in")).toBe(true);
  });
  it("signed up for order texts: Line 5a; key 1 = a different number", async () => {
    await optInOrderTexts();
    expect(said(await call("pay-approved-text", {}, `o=${orderId}`))).toEqual([LINE5A]);
    expect(redirect(await call("pay-approved-text-choice", { Digits: "1" }, `o=${orderId}`))).toBe(`tx-enter?p=conf&o=${orderId}`);
    expect(redirect(await call("pay-approved-text-choice", {}, `o=${orderId}`))).toBe(`receipt-email?o=${orderId}`); // no key
  });
  it("Line 8 after box 35: about 3 seconds; key 1 signs up, pound skips, no key skips; each then Line 7", async () => {
    const x = await call("promo-consent");
    expect(said(x)).toEqual([LINE8]);
    expect(gather(x)).toContain('timeout="3"');
    expect(redirect(x)).toBe("goodbye"); // no key
    expect(redirect(await call("promo-consent-answer", { Digits: "#" }))).toBe("goodbye"); // pound = skip only
    expect(redirect(await call("promo-consent-answer", { Digits: "1" }))).toBe("goodbye");
    const [c] = await db.select().from(schema.customers).where(eq(schema.customers.id, customerId));
    expect(c.marketingOptIn).toBe(true);
  });
  it("Line 8 is skipped for a caller who already gets promotions while the Admin switch is on (the default); asked when off", async () => {
    expect(redirect(await call("promo-consent"))).toBe("goodbye"); // opted in by the test above
    await saveSetting("paidPromoSkipOptedIn", false, null);
    expect(said(await call("promo-consent"))).toEqual([LINE8]);
    await saveSetting("paidPromoSkipOptedIn", true, null);
  });
  it("Line 7 ends a paid call; goodbye_order no longer plays", async () => {
    const x = await call("goodbye");
    expect(said(x)).toEqual([LINE7]);
    expect(x).toContain("<Hangup/>");
    expect(x).not.toContain("Have an amazing party");
    expect(readFileSync("src/lib/ivr/flow.ts", "utf8")).not.toMatch(/"goodbye_order(_days)?"/);
    expect(PROMPTS.goodbye_order).toBeTruthy(); // the slot stays in Admin
  });
  it("the old Line 6 (We look forward to serving you again. Thank you for choosing ...) never plays", async () => {
    const all = [await call("pay-approved", {}, `o=${orderId}`), await call("pay-approved-text", {}, `o=${orderId}`), await call("goodbye")].flatMap(said);
    expect(all).not.toContain("We look forward to serving you again. Thank you for choosing Hup Up Attractions!");
  });
});

describe("the order number is spoken only after payment approval", () => {
  it("Box 56 (the summary before payment) no longer says it; the only spoken use is Line 1", () => {
    const flow = readFileSync("src/lib/ivr/flow.ts", "utf8");
    expect(flow).not.toMatch(/"checkout_order_number"/);
    expect(flow.match(/sp\([^;]*"phonepay_approved"/g)?.length).toBe(1);
    const box56 = flow.slice(flow.indexOf("async function box56"), flow.indexOf("async function box56") + 1500);
    expect(box56).not.toMatch(/orderNumber\(/);
  });
});

describe("disconnect ending: items in the cart, silent", () => {
  let cartId = 0;
  beforeAll(async () => {
    const [o] = await db.insert(schema.orders).values({ status: "HOLD", channel: "PHONE", customerId, eventDate: "2026-12-14", pickupDate: "2026-12-15", subtotalCents: 15000 }).returning();
    cartId = o.id;
    await db.insert(schema.orderItems).values({ orderId: o.id, productId, qty: 1, unitPriceCents: 15000 });
  });
  const withCart = () => (h.session.data = { dayOrderIds: [cartId] });
  const ago = (ms: number) => String(Date.now() - ms);

  it("before 3 minutes: the usual no-choice line and the same step (no 1-minute end with items in the cart)", async () => {
    withCart();
    const x = await call("idle", {}, `to=cart&nk=${ago(90_000)}`);
    expect(said(x)).toEqual(["We did not get your choice. Please try again."]);
    expect(x).not.toContain("<Hangup/>");
    expect(redirect(x)).toMatch(/^cart\?nk=/);
  });
  it("after 3 minutes: the disconnect check; no key in 3 seconds = Line 7 and the call ends", async () => {
    withCart();
    const x = await call("idle", {}, `to=cart&nk=${ago(181_000)}`);
    expect(said(x)).toEqual([CHECK, LINE7]);
    expect(gather(x)).toContain('timeout="3"');
    expect(gather(x)).toContain('finishOnKey=""');
    expect(x.indexOf(CHECK)).toBeLessThan(x.indexOf("</Gather>"));
    expect(x.indexOf(LINE7)).toBeGreaterThan(x.indexOf("</Gather>"));
    expect(x.trim().endsWith("<Hangup/></Response>")).toBe(true);
  });
  it("any key returns the caller to the exact step they were on", async () => {
    withCart();
    const x = await call("idle", {}, `to=addr-house&q=${encodeURIComponent("t=1")}&nk=${ago(181_000)}`);
    const action = x.match(/action="([^"]+)"/)?.[1].replace(/&amp;/g, "&") ?? "";
    expect(action).toContain("disconnect-key");
    const back = await call("disconnect-key", { Digits: "5" }, new URL(action).searchParams.toString());
    expect(redirect(back)).toBe("addr-house?t=1");
  });
  it("the main menu with items in the cart: the same check after 3 minutes instead of the 3-play end", async () => {
    withCart();
    expect(said(await call("no-key", {}, `to=menu&np=3&t0=${ago(60_000)}`))).not.toContain(LINE7);
    expect(said(await call("no-key", {}, `to=menu&np=5&t0=${ago(181_000)}`))).toEqual([CHECK, LINE7]);
  });
  it("the 3 minutes and the 3 seconds come from Admin", async () => {
    withCart();
    await saveSetting("disconnectSilenceMinutes", "5", null);
    await saveSetting("disconnectCheckSeconds", "7", null);
    expect(said(await call("idle", {}, `to=cart&nk=${ago(181_000)}`))).not.toContain(CHECK);
    expect(gather(await call("idle", {}, `to=cart&nk=${ago(301_000)}`))).toContain('timeout="7"');
    await saveSetting("disconnectSilenceMinutes", "3", null);
    await saveSetting("disconnectCheckSeconds", "3", null);
  });
  it("empty cart: today's timing (1 minute), no disconnect check; Line 7 right before the hang-up (Abraham, 09:53 ET)", async () => {
    h.session.data = {};
    const early = await call("idle", {}, `to=book&nk=${ago(30_000)}`);
    expect(said(early)).toEqual(["We did not get your choice. Please try again."]);
    expect(early).not.toContain("<Hangup/>");
    const end = await call("idle", {}, `to=book&nk=${ago(61_000)}`);
    expect(said(end)).not.toContain(CHECK);
    expect(said(end)).toEqual([PROMPTS.no_input_final.text, LINE7]);
    expect(end.trim().endsWith(`${LINE7}</Say><Hangup/></Response>`)).toBe(true);
  });
  it("a caller who never ordered, silent on the main menu: Line 7 before the hang-up; the 3-play timing is unchanged", async () => {
    h.session.data = {};
    expect(await call("no-key", {}, `to=menu&np=2&t0=${ago(60_000)}`)).not.toContain("<Hangup/>");
    const end = await call("no-key", {}, `to=menu&np=3&t0=${ago(21_000)}`);
    expect(said(end)).toEqual([PROMPTS.no_input_final.text, LINE7]);
    expect(end).toContain("<Hangup/>");
  });
  it("the Admin switch (on by default) turns Line 7 off on those hang-ups; the timing stays the same", async () => {
    h.session.data = {};
    await saveSetting("disconnectGoodbyeOn", false, null);
    const end = await call("idle", {}, `to=book&nk=${ago(61_000)}`);
    expect(said(end)).toEqual([PROMPTS.no_input_final.text]);
    expect(end).toContain("<Hangup/>");
    await saveSetting("disconnectGoodbyeOn", true, null);
  });
});
