import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Line 8 seasonal offers sign-up (Abraham, Nov 26, 2026, 15:00 ET), built on the after-payment harness. Earlier note:
 * After-payment ending (Abraham, Nov 26, 2026, 09:38 to 09:45 ET, relayed by Hark): Lines 1 to 5, then Line 8, then
 * Line 7 and the call hangs up; the order number only after payment; goodbye_order no longer plays. Disconnect ending
 * (08:56 to 09:49 ET): a caller with items in the cart, silent for 3 minutes, hears the disconnect check; any key
 * returns to the same step; no key in 3 seconds = Line 7 and hang up; an empty cart keeps today's timing.
 */
const h = vi.hoisted(() => ({
  session: { callSid: "CAPROMO", fromNumber: "+18455550611", orderId: null as number | null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "checked_out", startedAt: new Date() },
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

const CALLER = "+18455550611";
const call = (action: string, body: Record<string, string> = {}, q = "") =>
  handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: "CAPROMO", ...body }, callSid: "CAPROMO", from: CALLER });
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

const OTHER = "+18455550622";
const WHICH = "To text it to the number you are calling from, press 1. To enter a different number, press 2.";

describe("Line 8: seasonal offers by text after a paid order", () => {
  it("a caller not signed up hears step 1 word for word (no pound key)", async () => {
    const x = await call("promo-consent");
    expect(said(x)).toEqual([LINE8]);
    expect(gather(x)).toContain('numDigits="1"');
    expect(redirect(x)).toBe("goodbye"); // no key within the wait: on to Line 7
  });
  it("no key: Line 7, then the call ends (nothing recorded, nothing sent)", async () => {
    const x = await call("promo-consent-answer");
    expect(redirect(x)).toBe("goodbye");
    const end = await call("goodbye");
    expect(said(end)).toEqual([LINE7]);
    expect(end).toContain("<Hangup/>");
    expect(h.sent).toEqual([]);
  });
  it("any other key (pound too): the not-valid line, then step 1 again", async () => {
    for (const d of ["#", "2", "9", "*"]) {
      const x = await call("promo-consent-answer", { Digits: d });
      expect(said(x)).toEqual(["Sorry, that is not a valid selection."]);
      expect(redirect(x)).toBe("promo-consent");
    }
  });
  it("press 1 -> step 2: the existing which-number line; star goes back to step 1", async () => {
    expect(redirect(await call("promo-consent-answer", { Digits: "1" }))).toBe("tx-which?p=promo");
    const which = await call("tx-which", {}, "p=promo");
    expect(said(which).join(" ")).toContain(WHICH);
    expect(redirect(await call("tx-which-choice", { Digits: "*" }, "p=promo"))).toBe("promo-consent");
  });
  it("press 1 -> different number -> read back -> confirm -> step 3 -> Line 7; the opt-in is recorded for that number", async () => {
    expect(redirect(await call("tx-which-choice", { Digits: "2" }, "p=promo"))).toBe("tx-enter?p=promo");
    expect(redirect(await call("tx-heard", { Digits: "8455550622#" }, "p=promo"))).toBe("tx-heard-again?p=promo");
    const heard = await call("tx-heard-again", {}, "p=promo");
    expect(said(heard).join(" ")).toMatch(/^I have /);
    const done = await call("tx-confirm", { Digits: "1" }, "p=promo");
    expect(said(done)).toEqual([JOINED]);
    expect(redirect(done)).toBe("goodbye");
    const [row] = await db.select().from(schema.smsConsents).where(eq(schema.smsConsents.phone, OTHER));
    expect(row).toMatchObject({ scope: "marketing", action: "opt_in", source: "phone", method: "keypad", wording: LINE8, callerPhone: CALLER, callSid: "CAPROMO" });
    expect(row.response).toContain("phone after paid order");
    expect(row.response).toContain("a different number");
    expect(h.sent.map((m) => m.to)).toEqual([OTHER]); // the one sign-up confirmation text
  });
  it("press 1 -> the number calling -> step 3 -> Line 7; opt-in row with time, source and the exact step 1 words", async () => {
    const before = Date.now() - 1000;
    const x = await call("tx-which-choice", { Digits: "1" }, "p=promo");
    expect(said(x)).toEqual([JOINED]);
    expect(redirect(x)).toBe("goodbye");
    const [row] = await db.select().from(schema.smsConsents).where(eq(schema.smsConsents.phone, CALLER));
    expect(row).toMatchObject({ scope: "marketing", action: "opt_in", wording: LINE8 });
    expect(row.response).toBe("phone after paid order: pressed 1 to join; number: the number calling (pressed 1)");
    expect(row.createdAt.getTime()).toBeGreaterThanOrEqual(before);
    const [c] = await db.select().from(schema.customers).where(eq(schema.customers.id, customerId));
    expect(c.marketingOptIn).toBe(true);
    expect(h.sent.map((m) => m.to)).toEqual([CALLER]);
  });
  it("a caller already signed up skips straight to the goodbye", async () => {
    expect(redirect(await call("promo-consent"))).toBe("goodbye");
  });
  it("a number that replied STOP is never signed up and gets no text", async () => {
    const blocked = "+18455550633";
    await db.insert(schema.customers).values({ name: "Blocked", phone: blocked, smsOptOut: true });
    await call("tx-heard", { Digits: "8455550633#" }, "p=promo");
    const x = await call("tx-confirm", { Digits: "1" }, "p=promo");
    expect(said(x)).not.toContain(JOINED);
    expect(redirect(x)).toBe("goodbye");
    expect(await db.select().from(schema.smsConsents).where(eq(schema.smsConsents.phone, blocked))).toEqual([]);
    expect(h.sent).toEqual([]);
  });
  it("the confirmation text is the sign-up confirmation (a system text the caller asked for on this call, sent right away), never a promotion held for quiet hours; Shabbes and Yom Tov: the phone line is closed, so no paid order and no sign-up can happen then", () => {
    const flow = readFileSync("src/lib/ivr/flow.ts", "utf8");
    const join = flow.slice(flow.indexOf("async function promoJoin"), flow.indexOf("function txPurpose"));
    expect(join).toContain('kind: "system", event: "consent_confirmation"');
    expect(join).not.toContain('kind: "marketing"');
  });
  it("both slots are in Admin with their labels; the screen explanation describes the new keys", () => {
    expect(PROMPTS.paid_promo_offer.label).toContain("Line 8 (step 1)");
    expect(PROMPTS.promo_joined.label).toContain("Line 8 (step 3)");
    expect(PROMPTS.promo_joined.text).toBe(JOINED);
    expect(readFileSync("src/lib/ivr/screen-explanations.ts", "utf8")).toContain("Key 1 signs up, then the caller chooses the number");
  });
});
