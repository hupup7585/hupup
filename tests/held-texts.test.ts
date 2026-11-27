import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

/* Late offer texts and Shabbes (Abraham, Nov 27, 2026, 2:14 AM, option B): no Twilio scheduling; held texts wait in our
 * database and a free timer sends them when allowed, rechecked first. In-memory database, fake Twilio. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema, closeDb: async () => {} };
});
vi.mock("@/lib/r2", () => ({ r2Ready: () => false, r2Put: async () => undefined, r2Delete: async () => undefined, r2Get: async () => new Response(null, { status: 404 }) }));

const { db, schema } = await import("@/lib/db");
const { setTwilioForTests } = await import("@/lib/twilio-client");
const sms = await import("@/lib/sms");
const consent = await import("@/lib/sms-consent");
const { handleInboundSms } = await import("@/lib/sms-inbound");

const sent: { to: string; body: string }[] = [];
let seq = 0;
const fakeMessages = Object.assign((_sid: string) => ({ update: async () => ({}) }), {
  create: async (p: { to: string; body: string; sendAt?: unknown; scheduleType?: unknown }) => {
    expect(p.sendAt).toBeUndefined(); // never Twilio Message Scheduling (it costs money)
    expect(p.scheduleType).toBeUndefined();
    sent.push({ to: p.to, body: p.body });
    return { sid: `SM${++seq}`, status: "queued" };
  },
});
let n = 0;
const newPhone = () => `+1845556${String(1000 + ++n)}`;
const promoReady = async (p: string) => {
  await consent.recordConsent({ phone: p, scope: "marketing", action: "opt_in", source: "web", method: "checkbox", wording: "W", wordingVersion: "v1" });
};
const row = async (id: number) => (await db.select().from(schema.messages).where(eq(schema.messages.id, id)))[0];
const toP = (p: string) => sent.filter((x) => x.to === p);

beforeAll(() => {
  process.env.TWILIO_PHONE_NUMBER = "+18454157585";
  setTwilioForTests({ messages: fakeMessages });
});
beforeEach(() => {
  sent.length = 0;
});

describe("offer texts held in our database (no Twilio scheduling)", () => {
  it("an offer at 10 PM is held and sent at the first allowed morning time (8 AM)", async () => {
    const p = newPhone();
    await promoReady(p);
    const tenPm = new Date("2026-11-18T03:00:00Z"); // Tuesday Nov 17, 10 PM Eastern
    const r = await sms.sendMessage({ to: p, body: "Winter sale", kind: "marketing", now: tenPm });
    expect(r.held).toBe(true);
    expect(toP(p)).toHaveLength(0);
    expect((await row(r.messageId!)).sendAfter?.toISOString()).toBe("2026-11-18T13:00:00.000Z"); // 8 AM Eastern
    await sms.processHeldPromotions(new Date("2026-11-18T12:00:00Z")); // 7 AM: not yet
    expect(toP(p)).toHaveLength(0);
    await sms.processHeldPromotions(new Date("2026-11-18T13:05:00Z"));
    expect(toP(p)).toHaveLength(1);
  });
  it("a STOP reply in between cancels it", async () => {
    const p = newPhone();
    await promoReady(p);
    const r = await sms.sendMessage({ to: p, body: "Winter sale", kind: "marketing", now: new Date("2026-11-18T03:00:00Z") });
    await handleInboundSms({ From: p, Body: "STOP", MessageSid: `SMin${++seq}` });
    await sms.processHeldPromotions(new Date("2026-11-18T13:05:00Z"));
    expect(toP(p)).toHaveLength(0);
    expect((await row(r.messageId!)).status).toBe("canceled");
  });
  it("the yearly limit (5) is checked again right before sending", async () => {
    const p = newPhone();
    await promoReady(p);
    const r = await sms.sendMessage({ to: p, body: "Winter sale", kind: "marketing", now: new Date("2026-11-18T03:00:00Z") });
    // five more promos went out in the meantime (counted for the year)
    for (let i = 0; i < 5; i++) await db.insert(schema.messages).values({ direction: "out", toNumber: p, contactPhone: p, body: "x", kind: "marketing", status: "delivered" });
    await sms.processHeldPromotions(new Date("2026-11-18T13:05:00Z"));
    expect(toP(p)).toHaveLength(0);
    expect((await row(r.messageId!)).status).toBe("canceled");
  });
  it("Friday evening offers wait until after Shabbes (after havdalah), even in the morning hours of Shabbes", async () => {
    const p = newPhone();
    await promoReady(p);
    const friEve = new Date("2026-11-20T23:00:00Z"); // Friday 6 PM Eastern, after candle lighting
    const r = await sms.sendMessage({ to: p, body: "Chanukah sale", kind: "marketing", now: friEve });
    expect(r.held).toBe(true);
    const after = (await row(r.messageId!)).sendAfter!;
    const { bookingLock } = await import("@/lib/jewish-calendar");
    const ends = bookingLock(new Date("2026-11-21T17:00:00Z")).opensAt!; // when Shabbes is over
    expect(after.getTime()).toBeGreaterThanOrEqual(ends.getTime());
    await sms.processHeldPromotions(new Date("2026-11-21T14:00:00Z")); // Shabbes morning 9 AM: still waits
    expect(toP(p)).toHaveLength(0);
    await sms.processHeldPromotions(after);
    expect(toP(p)).toHaveLength(1);
  });
});

describe("Shabbes and Yom Tov (option B)", () => {
  const shabbes = new Date("2026-11-21T16:00:00Z"); // Shabbes, 11 AM Eastern
  it("a text the customer asked for (catalog by text) goes out at once on Shabbes", async () => {
    const p = newPhone();
    const r = await sms.sendMessage({ to: p, body: "Hup Up Attractions: Here is our catalog!", kind: "system", event: "catalog_reply", now: shabbes });
    expect(r.sent).toBe(true);
    expect(toP(p)).toHaveLength(1);
  });
  it("a promo due on Shabbes waits until after havdalah", async () => {
    const p = newPhone();
    await promoReady(p);
    const r = await sms.sendMessage({ to: p, body: "Sale", kind: "marketing", now: shabbes });
    expect(r.held).toBe(true);
    expect(toP(p)).toHaveLength(0);
  });
  it("an Owner alert text on Shabbes is held and sent right after Shabbes", async () => {
    const owner = newPhone();
    const r = await sms.sendMessage({ to: owner, body: "Hup Up order problem: test.", kind: "system", event: "owner_alert", now: shabbes });
    expect(r.held).toBe(true);
    expect(toP(owner)).toHaveLength(0);
    const after = (await row(r.messageId!)).sendAfter!;
    await sms.processHeldPromotions(new Date(shabbes.getTime() + 60 * 60_000));
    expect(toP(owner)).toHaveLength(0);
    await sms.processHeldPromotions(after);
    expect(toP(owner)).toHaveLength(1);
  });
});
