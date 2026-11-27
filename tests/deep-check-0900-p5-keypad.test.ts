import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Deep check Nov 27, 9:00 AM, P5 (M19, NOT FIXED) and P6, simulated calls on the Stripe keypad path (off today):
 * P5: the call recording runs on the caller's hotline call; it was "paused" on the payment subaccount's call (which
 * failed silently), so card tones were recorded. Now it is paused on the hotline call before the card entry is dialed,
 * the payment line is never recorded, a pause that fails means no card entry (the payment link instead), and the
 * recording goes on back on our line. P6: a retry on the payment line renewed a hold that had ended without checking
 * stock; now it is renewed only when the whole order is still free.
 */
const h = vi.hoisted(() => ({
  session: { callSid: "CAmain", fromNumber: "+18457777585", orderId: null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing" },
  emails: [] as { to: string; subject: string; text: string }[],
  rec: [] as string[],
  pauseFails: false,
}));
vi.mock("@/lib/call-recording", () => ({
  pauseRecording: async (sid: string) => {
    if (h.pauseFails) throw new Error("no recording to pause");
    h.rec.push(`pause ${sid}`);
  },
  resumeRecording: async (sid: string) => void h.rec.push(`resume ${sid}`),
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

process.env.STRIPE_PHONE_PAY_MODE = "owner_test"; // Stripe is the off-by-default backup since Nov 14, 2026 (Sola PhonePay is main)
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
async function newOrder(item?: { productId: number }) {
  const [c] = await db.insert(schema.customers).values({ name: "Test Caller", phone: "+18457777585", email: "caller@example.com" }).returning();
  const [o] = await db
    .insert(schema.orders)
    .values({ status: "PENDING_PAYMENT", channel: "PHONE", customerId: c.id, eventDate: "2026-12-15", pickupDate: "2026-12-16", deliveryAddress: "12 Forest Road, Monroe", subtotalCents: 20000, deliveryZone: "area", deliveryFeeCents: 1500, taxPercent: "8.125", taxCents: 1747, totalCents: 23247, holdExpiresAt: new Date(Date.now() + 600_000) })
    .returning();
  if (item) await db.insert(schema.orderItems).values({ orderId: o.id, productId: item.productId, qty: 1, unitPriceCents: 20000 });
  return o.id;
}

beforeAll(() => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  process.env.AUTH_SECRET = "test-secret";
  Object.assign(process.env, ENV);
});
beforeEach(async () => {
  h.rec.length = 0;
  h.pauseFails = false;
  h.session.data = { email: "caller@example.com", recording: true };
  orderId = await newOrder();
});

describe("deep check 09:00 P5 (M19): the recording never hears the card", () => {
  it("recording on: paused on the hotline call before the payment line is dialed; the payment line is not recorded; resumed back on our line", async () => {
    const xml = await mainCall("pay-keypad", {}, `o=${orderId}`);
    expect(h.rec).toEqual(["pause CAmain"]);
    expect(xml).toMatch(/<Dial [^>]*record="do-not-record"/);
    expect(xml).toContain("hupup-pay.sip.twilio.com");
    await mainCall("pay-done", {}, `o=${orderId}`);
    expect(h.rec).toEqual(["pause CAmain", "resume CAmain"]);
  });
  it("the pause fails: no card entry (never dialed while recording), the payment link instead", async () => {
    h.pauseFails = true;
    const xml = await mainCall("pay-keypad", {}, `o=${orderId}`);
    expect(xml).not.toContain("<Dial");
    expect(redirect(xml)).toBe(`paylink?o=${orderId}`);
  });
  it("recording off: nothing paused or resumed, the card entry as before", async () => {
    h.session.data = { email: "caller@example.com" };
    const xml = await mainCall("pay-keypad", {}, `o=${orderId}`);
    expect(h.rec).toEqual([]);
    expect(xml).toContain("hupup-pay.sip.twilio.com");
  });
});

describe("deep check 09:00 P6: a retry on the payment line renews only a hold whose items are still free", () => {
  const sub = (action: string, body: Record<string, string>) => handlePayVoice(action, new URLSearchParams(), { AccountSid: "ACpay", CallSid: "CApay", ...body });
  it("the hold ended and someone else booked the only unit: no card entry, hold not renewed", async () => {
    const [cat] = await db.insert(schema.categories).values({ name: "Bounce P6", sortOrder: 1 }).returning();
    const [p] = await db.insert(schema.products).values({ categoryId: cat.id, name: "Castle P6", priceCents: 20000, quantity: 1 }).returning();
    const mine = await newOrder({ productId: p.id });
    await db.update(schema.orders).set({ holdExpiresAt: new Date(Date.now() - 60_000) }).where(eq(schema.orders.id, mine));
    const [other] = await db.insert(schema.orders).values({ status: "CONFIRMED", channel: "PHONE", eventDate: "2026-12-15", pickupDate: "2026-12-16" }).returning();
    await db.insert(schema.orderItems).values({ orderId: other.id, productId: p.id, qty: 1, unitPriceCents: 20000 });
    const xml = await sub("incoming", sipHeaders(paySipUri(mine, "CAmain")));
    expect(xml).not.toContain("<Pay");
    expect(xml).toContain("<Hangup/>");
    expect((await order(mine)).holdExpiresAt!.getTime()).toBeLessThan(Date.now());
  });
  it("the hold ended but the item is still free: renewed, the card entry goes on", async () => {
    const [cat] = await db.insert(schema.categories).values({ name: "Bounce P6b", sortOrder: 1 }).returning();
    const [p] = await db.insert(schema.products).values({ categoryId: cat.id, name: "Castle P6b", priceCents: 20000, quantity: 1 }).returning();
    const mine = await newOrder({ productId: p.id });
    await db.update(schema.orders).set({ holdExpiresAt: new Date(Date.now() - 60_000) }).where(eq(schema.orders.id, mine));
    const xml = await sub("incoming", sipHeaders(paySipUri(mine, "CAmain")));
    expect(xml).toMatch(/<Pay /);
    expect((await order(mine)).holdExpiresAt!.getTime()).toBeGreaterThan(Date.now());
  });
});
