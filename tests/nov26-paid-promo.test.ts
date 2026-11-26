import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/* The promo question after a paid order (Abraham, Nov 26, 2026, approved wording): right after payment and the order
 * number lines, before the thank-you and goodbye. 1 = promotional texts only; pound or 5 seconds = skip, no change;
 * already opted in (or replied STOP): not asked. */
const h = vi.hoisted(() => ({
  session: { callSid: "CApromo", fromNumber: "+18455550188", orderId: null as number | null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "ordered" },
  sent: [] as { to: string; body: string }[],
  overrides: {} as Record<string, unknown>,
}));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/session", () => ({
  ensureSession: async () => h.session,
  getSession: async () => h.session,
  updateSession: async (_s: string, patch: { data?: Record<string, unknown> } & Record<string, unknown>) => {
    const { data, ...rest } = patch;
    Object.assign(h.session, rest);
    if (data) h.session.data = { ...h.session.data, ...data };
  },
}));
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => h.overrides }));
vi.mock("@/lib/notify", () => ({ sendSms: async () => ({ sent: true }), sendEmail: async () => ({ sent: true }) }));
vi.mock("@/lib/twilio-client", () => ({ getTwilio: () => ({ messages: { create: async (p: { to: string; body: string }) => (h.sent.push({ to: p.to, body: p.body }), { sid: `SM${h.sent.length}`, status: "queued" }) } }) }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { handleVoice } from "@/lib/ivr/flow";
import { PROMPTS } from "@/lib/ivr/prompts";
import { PROMO_ENROLLED_SMS } from "@/lib/sms-terms-v2";

const ASK = "To get seasonal offers, discounts, and deals by text, up to 6 a year, press 1. To skip, press pound.";
let PHONE = "+18455550188";
const call = (action: string, body: Record<string, string> = {}) => handleVoice({ action, query: new URLSearchParams(), body: { CallSid: "CApromo", ...body }, callSid: "CApromo", from: PHONE });
const plain = (x: string) => x.replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const said = (xml: string) => [...xml.matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => plain(m[1]));
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace(/^.*\/api\/voice\//, "");
const customer = async () => (await db.select().from(schema.customers).where(eq(schema.customers.phone, PHONE)))[0];
const marketing = async () => (await db.select().from(schema.smsConsents)).filter((r) => r.phone === PHONE && r.scope === "marketing");
let n = 0;

/** A paid order on this call. */
async function paidOrder(paid = true) {
  const [o] = await db.insert(schema.orders).values({ status: paid ? "CONFIRMED" : "PENDING_PAYMENT", channel: "PHONE", eventDate: "2027-05-10", pickupDate: "2027-05-11", subtotalCents: 20000, totalCents: 20000, paidCents: paid ? 20000 : 0, paymentStatus: paid ? "paid" : "unpaid" } as never).returning();
  h.session.data = { placedOrderId: o.id };
  return o.id;
}

beforeAll(() => {
  Object.assign(process.env, { PUBLIC_BASE_URL: "https://hupup.example" });
});
beforeEach(async () => {
  PHONE = `+1845555${String(1000 + n++)}`;
  h.sent.length = 0;
  h.overrides = {};
  await paidOrder();
});

describe("the slot", () => {
  it("paid_promo_offer: the exact approved text, its own Admin slot (Google voice until a recording is uploaded)", () => {
    expect(PROMPTS.paid_promo_offer.text).toBe(ASK);
    expect(PROMPTS.paid_promo_offer.label).toContain("After a paid order");
    expect("pending" in PROMPTS.paid_promo_offer).toBe(false);
  });
});

describe("after a paid order", () => {
  it("asks the question (keys only, 5 seconds), then the thank-you and goodbye", async () => {
    const xml = await call("promo-consent");
    expect(said(xml)).toEqual([ASK]);
    expect(xml).toMatch(/<Gather [^>]*input="dtmf"[^>]*timeout="5"/);
    expect(redirect(xml)).toBe("goodbye");
  });
  it("its recording plays once uploaded", async () => {
    h.overrides = { paid_promo_offer: { text: null, audioUrl: null, recordingId: 5150 } };
    expect(await call("promo-consent")).toMatch(/<Play>[^<]*5150[^<]*<\/Play>/);
  });
  it("press 1: promotional texts only, recorded with the exact words; nothing more is played; then the goodbye", async () => {
    const xml = await call("promo-consent-answer", { Digits: "1" });
    expect(said(xml)).toEqual([]);
    expect(redirect(xml)).toBe("goodbye");
    const rows = await marketing();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "opt_in", source: "phone", method: "keypad", wording: ASK, response: "pressed 1", callSid: "CApromo" });
    expect((await customer()).marketingOptIn).toBe(true);
    // order-text consent unchanged: no transactional row written
    expect((await db.select().from(schema.smsConsents)).filter((r) => r.phone === PHONE && r.scope === "transactional")).toHaveLength(0);
    // the approved sign-up confirmation text (SMS v3), logged on the contact (test builds don't reach Twilio)
    const texts = (await db.select().from(schema.messages)).filter((m) => m.contactPhone === PHONE && m.direction === "out");
    expect(texts.map((m) => m.body)).toEqual([PROMO_ENROLLED_SMS]);
  });
  it("pound: skip, no change", async () => {
    const xml = await call("promo-consent-answer", { Digits: "#" });
    expect(redirect(xml)).toBe("goodbye");
    expect(said(xml)).toEqual([]);
    expect(await marketing()).toHaveLength(0);
    expect((await customer())?.marketingOptIn ?? false).toBe(false);
    expect((await db.select().from(schema.messages)).filter((m) => m.contactPhone === PHONE)).toHaveLength(0);
  });
  it("no key in 5 seconds: skip, no change", async () => {
    const xml = await call("promo-consent");
    expect(redirect(xml)).toBe("goodbye"); // Twilio falls through to the goodbye after the 5 seconds
    expect(await marketing()).toHaveLength(0);
    const answer = await call("promo-consent-answer", {});
    expect(redirect(answer)).toBe("goodbye");
    expect(await marketing()).toHaveLength(0);
  });
  it("a wrong key: the shared line, then the question again", async () => {
    const xml = await call("promo-consent-answer", { Digits: "5" });
    expect(said(xml)).toEqual([PROMPTS.not_valid.text]);
    expect(redirect(xml)).toBe("promo-consent");
  });
  it("already opted in to promos: not asked", async () => {
    await db.insert(schema.customers).values({ phone: PHONE, marketingOptIn: true });
    const xml = await call("promo-consent");
    expect(said(xml)).toEqual([]);
    expect(redirect(xml)).toBe("goodbye");
  });
  it("a number that replied STOP: not asked, and a 1 cannot sign it up (START + YES only)", async () => {
    await db.insert(schema.customers).values({ phone: PHONE, smsOptOut: true });
    expect(said(await call("promo-consent"))).toEqual([]);
    expect(redirect(await call("promo-consent-answer", { Digits: "1" }))).toBe("goodbye");
    expect((await customer()).marketingOptIn).toBe(false);
    expect((await db.select().from(schema.messages)).filter((m) => m.contactPhone === PHONE)).toHaveLength(0);
  });
  it("an order not paid yet: not asked", async () => {
    await paidOrder(false);
    expect(said(await call("promo-consent"))).toEqual([]);
  });
});
