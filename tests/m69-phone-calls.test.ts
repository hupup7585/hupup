import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/*
 * Deep check 0600 M69 (phone part): simulated calls through the 3 AM phone fixes, which had source-text tests only.
 * Real hotline steps (handleVoice), real call sessions and orders in the in-memory database, the clock pinned to the
 * moments that matter (Friday Jan 15, 2027: Shabbes candle lighting about 4:35 PM, the phone's cut-off 15 minutes
 * before; Motzei Shabbes the phone opens at 6:07 PM).
 */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));
vi.mock("@/lib/notify", () => ({ sendSms: async () => ({ sent: true }), sendEmail: async () => ({ sent: true }), sendOrderText: async () => ({ texted: true }) }));
vi.mock("@/lib/twilio-client", () => ({ getTwilio: () => null }));

import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { handleCallStatus, handleVoice } from "@/lib/ivr/flow";
import { PHONE_HOLD_MINUTES, releaseExpired, reserveItem } from "@/lib/orders";
import { ensureSession, getSession, updateSession } from "@/lib/ivr/session";

const at = (iso: string) => {
  vi.setSystemTime(new Date(iso));
  process.env.HUP_CALENDAR_NOW = iso;
};
const say = (xml: string) => [...xml.matchAll(/<Say[^>]*>([^<]*)<\/Say>/g)].map((m) => m[1]).join(" ");
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace(/^.*\/api\/voice\//, "").replace(/&amp;/g, "&");
const gatherTo = (xml: string) => xml.match(/<Gather[^>]*action="([^"]+)"/)?.[1].replace(/^.*\/api\/voice\//, "").replace(/&amp;/g, "&");

let castle = 0;
let n = 0;
beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  const [c] = await db.insert(schema.categories).values({ name: "Bounce Houses", sortOrder: 1 }).returning();
  const [p] = await db.insert(schema.products).values({ categoryId: c.id, name: "Castle", priceCents: 20000, quantity: 1 }).returning();
  castle = p.id;
});
afterAll(() => {
  vi.useRealTimers();
  process.env.HUP_CALENDAR_NOW = "2026-11-17T17:00:00Z";
});

/** A caller (own number), with one call per sid. */
function caller() {
  const from = `+184555509${String(++n).padStart(2, "0")}`;
  const call = (sid: string, action: string, body: Record<string, string> = {}, q = "") => handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: sid, ...body }, callSid: sid, from });
  /** This call puts one Castle for `day` in its cart, the way the booking steps leave it (held, in dayOrderIds). */
  const cart = async (sid: string, day: string) => {
    await ensureSession(sid, from);
    const r = await reserveItem({ orderId: null, productId: castle, qty: 1, eventDate: day, channel: "PHONE", status: "HOLD", holdExpiresAt: new Date(Date.now() + PHONE_HOLD_MINUTES * 60_000), callSid: sid } as never);
    if (!r.ok) throw new Error("not reserved");
    await updateSession(sid, { orderId: r.orderId, outcome: "carted", data: { dayOrderIds: [r.orderId], day } });
    return r.orderId;
  };
  return { from, call, cart };
}
const order = async (id: number) => (await db.select().from(schema.orders).where(eq(schema.orders.id, id)))[0];
/** Shabbes Jan 16, 2027 is over in these tests: every Castle hold is given back so each test starts with stock. */
const freeStock = async () => {
  const rows = await db.select({ id: schema.orders.id }).from(schema.orders).where(inArray(schema.orders.status, ["HOLD", "PENDING_PAYMENT"]));
  if (rows.length) await db.update(schema.orders).set({ status: "CANCELLED" }).where(inArray(schema.orders.id, rows.map((r) => r.id)));
};

/** Friday 4:22 PM: a cart; 4:30 PM (after the cut-off): the next step saves it; a call on Shabbes; a call back. */
async function savedBeforeShabbes() {
  await freeStock();
  const c = caller();
  at("2027-01-15T21:22:00Z");
  const id = await c.cart("CAa" + n, "2027-01-17");
  at("2027-01-15T21:30:00Z");
  const cut = await c.call("CAa" + n, "cart");
  await handleCallStatus("CAa" + n, "completed");
  at("2027-01-16T17:00:00Z"); // Shabbes noon: the closed greeting, no cart
  await ensureSession("CAb" + n, c.from);
  const shabbes = await c.call("CAb" + n, "incoming");
  await handleCallStatus("CAb" + n, "completed");
  return { c, id, cut, shabbes, back: "CAc" + n };
}

describe("item 6: a cart saved before Shabbes survives a call during Shabbes", () => {
  it("the cut-off saves the cart (its line, then hang up); a call on Shabbes hears the closed greeting; Motzei Shabbes offers the cart", async () => {
    const s = await savedBeforeShabbes();
    expect(say(s.cut)).toContain("We will save your items until one hour after Shabbes, Saturday night, at 7:07 PM.");
    expect(s.cut).toContain("<Hangup/>");
    expect((await order(s.id)).status).toBe("HOLD");
    expect(say(s.shabbes)).toContain("We are closed now for Shabbes");
    expect((await order(s.id)).status).toBe("HOLD"); // the Shabbes call never touched it
    at("2027-01-16T23:30:00Z"); // Motzei Shabbes 6:30 PM: the phone is open, the cart still saved
    await ensureSession(s.back, s.c.from);
    expect(redirect(await s.c.call(s.back, "book"))).toBe("resume");
    const offer = await s.c.call(s.back, "resume");
    expect(say(offer)).toContain("Welcome back! On your last call you had in your cart one Castle for Sunday, January seventeenth.");
    expect(gatherTo(offer)).toBe("resume-choice");
  });

  it("press 1: the saved hold makes way for this call's hold and the Castle goes into this call's cart", async () => {
    const s = await savedBeforeShabbes();
    at("2027-01-16T23:30:00Z");
    await ensureSession(s.back, s.c.from);
    await s.c.call(s.back, "resume");
    expect(redirect(await s.c.call(s.back, "resume-choice", { Digits: "1" }))).toBe("resume-items");
    expect((await order(s.id)).status).toBe("CANCELLED"); // the Shabbes save given back to stock ...
    const items = await s.c.call(s.back, "resume-items");
    expect(redirect(items)).toMatch(/^resume-added\?d=2027-01-17/);
    const sess = await getSession(s.back);
    const now = await order(sess!.orderId!); // ... and held again for this call, in its cart
    expect(now.status).toBe("HOLD");
    expect(now.callSid).toBe(s.back);
    expect(now.eventDate).toBe("2027-01-17");
    expect(sess!.data.dayOrderIds).toEqual([now.id]);
  });

  it("press 2: a new order; the saved cart goes back to stock", async () => {
    const s = await savedBeforeShabbes();
    at("2027-01-16T23:30:00Z");
    await ensureSession(s.back, s.c.from);
    await s.c.call(s.back, "resume");
    expect(redirect(await s.c.call(s.back, "resume-choice", { Digits: "2" }))).toBe("book");
    expect((await order(s.id)).status).toBe("CANCELLED");
  });

  it("star, a wrong key, no key: back to the main menu / not valid and the same offer / the no-choice line; the saved cart stays held", async () => {
    const s = await savedBeforeShabbes();
    at("2027-01-16T23:30:00Z");
    await ensureSession(s.back, s.c.from);
    await s.c.call(s.back, "resume");
    expect(redirect(await s.c.call(s.back, "resume-choice", { Digits: "*" }))).toBe("menu");
    const wrong = await s.c.call(s.back, "resume-choice", { Digits: "7" });
    expect(say(wrong)).toContain("Sorry, that is not a valid selection.");
    expect(redirect(wrong)).toBe("resume");
    expect(redirect(await s.c.call(s.back, "resume-choice", {}))).toBe("idle?to=resume");
    expect((await order(s.id)).status).toBe("HOLD");
  });

  it("the same Castle can't be booked by another caller while it is saved", async () => {
    const s = await savedBeforeShabbes();
    at("2027-01-16T23:30:00Z");
    const other = caller();
    await ensureSession("CAother" + n, other.from);
    await expect(other.cart("CAother" + n, "2027-01-17")).rejects.toThrow("not reserved");
    expect((await order(s.id)).status).toBe("HOLD");
  });
});

/** Monday Jan 18, 2027 (an ordinary weekday): a cart for the same day, then the caller hangs up. */
async function sameDayCart(day = "2027-01-18") {
  await freeStock();
  const c = caller();
  at("2027-01-18T15:00:00Z"); // 10 AM
  const id = await c.cart("CAd" + n, day);
  await handleCallStatus("CAd" + n, "completed");
  return { c, id, back: "CAe" + n };
}

describe("item 8: welcome back leaves out days that can no longer be booked", () => {
  it("before the same-day cut-off (2 PM): today's cart is offered", async () => {
    const s = await sameDayCart();
    expect((await order(s.id)).status).toBe("CANCELLED"); // hanging up gives the hold back
    at("2027-01-18T19:00:00Z");
    await ensureSession(s.back, s.c.from);
    expect(redirect(await s.c.call(s.back, "book"))).toBe("resume");
    expect(say(await s.c.call(s.back, "resume"))).toContain("one Castle for Monday, January eighteenth");
  });
  it("after the same-day cut-off (3:45 PM): today's cart is left out, so no welcome back (the bookings menu)", async () => {
    const s = await sameDayCart();
    at("2027-01-18T20:45:00Z");
    await ensureSession(s.back, s.c.from);
    const book = await s.c.call(s.back, "book");
    expect(redirect(book)).not.toBe("resume");
    expect(gatherTo(book)).toBe("book-choice");
    expect(say(book)).not.toContain("Welcome back");
    expect(redirect(await s.c.call(s.back, "resume"))).toBe("book");
  });
  it("a later day is still offered after the cut-off", async () => {
    const s = await sameDayCart("2027-01-20");
    at("2027-01-18T20:45:00Z");
    await ensureSession(s.back, s.c.from);
    expect(redirect(await s.c.call(s.back, "book"))).toBe("resume");
  });
  it("a cart for a Shabbes day is never offered", async () => {
    await freeStock();
    const c = caller();
    at("2027-01-18T15:00:00Z");
    const id = await c.cart("CAf" + n, "2027-01-23"); // saved straight into the data: a day that is closed
    void id;
    await handleCallStatus("CAf" + n, "completed");
    await ensureSession("CAg" + n, c.from);
    expect(redirect(await c.call("CAg" + n, "resume"))).toBe("book");
  });
  it("the hourly tidy-up releasing the hold doesn't change it", async () => {
    const s = await sameDayCart();
    at("2027-01-18T19:00:00Z");
    await releaseExpired();
    await ensureSession(s.back, s.c.from);
    expect(redirect(await s.c.call(s.back, "book"))).toBe("resume");
  });
});

describe("item 5: the closed-day offer never books today after the same-day cut-off", () => {
  const p = () => String(castle);
  const asks = async (c: ReturnType<typeof caller>, sid: string) => c.call(sid, "date-heard", { Digits: "0116" }, `p=${p()}`); // Saturday, Jan 16
  it("Friday 10 AM (before chatzos): Saturday is closed, so 'get it Friday' is offered; 1 books Friday with the 1.5-day span", async () => {
    await freeStock();
    const c = caller();
    at("2027-01-15T15:00:00Z");
    await ensureSession("CAh" + n, c.from);
    expect(redirect(await asks(c, "CAh" + n))).toBe(`closed-offer?p=${p()}&d=2027-01-16`);
    const offer = await c.call("CAh" + n, "closed-offer", {}, `p=${p()}&d=2027-01-16`);
    expect(gatherTo(offer)).toBe(`closed-offer-choice?p=${p()}&d=2027-01-16`);
    expect(say(offer)).toContain("Friday, January fifteenth");
    expect(redirect(await c.call("CAh" + n, "closed-offer-choice", { Digits: "1" }, `p=${p()}&d=2027-01-16`))).toBe(`qty?p=${p()}&d=2027-01-15`);
    expect((await getSession("CAh" + n))!.data.spanDays?.["2027-01-15"]).toEqual({ after: "2027-01-17", days: 1.5 });
  });
  it("before chatzos: 2 another date, star back, a wrong key repeats the offer, no key the no-choice path", async () => {
    const c = caller();
    at("2027-01-15T15:00:00Z");
    await ensureSession("CAi" + n, c.from);
    const q = `p=${p()}&d=2027-01-16`;
    expect(redirect(await c.call("CAi" + n, "closed-offer-choice", { Digits: "2" }, q))).toBe(`date?p=${p()}`);
    const wrong = await c.call("CAi" + n, "closed-offer-choice", { Digits: "5" }, q);
    expect(say(wrong)).toContain("Sorry, that is not a valid selection.");
    expect(redirect(wrong)).toBe(`closed-offer?${q}`);
    expect(await c.call("CAi" + n, "closed-offer-choice", {}, q)).toContain("closed-offer");
    expect(await c.call("CAi" + n, "closed-offer-choice", { Digits: "*" }, q)).not.toContain("qty?");
  });
  it("Friday 1:30 PM (after chatzos): Saturday is closed and no offer is made (today can't be booked anymore)", async () => {
    const c = caller();
    at("2027-01-15T18:30:00Z");
    await ensureSession("CAj" + n, c.from);
    const xml = await asks(c, "CAj" + n);
    expect(xml).not.toContain("closed-offer");
    expect(redirect(xml)).toBe(`date?p=${p()}`);
    expect(redirect(await c.call("CAj" + n, "closed-offer", {}, `p=${p()}&d=2027-01-16`))).toBe(`date?p=${p()}`);
  });
  it("heard before chatzos, pressed 1 after it: nothing is booked for today, back to the date", async () => {
    const c = caller();
    at("2027-01-15T16:59:00Z");
    await ensureSession("CAk" + n, c.from);
    expect(gatherTo(await c.call("CAk" + n, "closed-offer", {}, `p=${p()}&d=2027-01-16`))).toContain("closed-offer-choice");
    at("2027-01-15T18:30:00Z");
    expect(redirect(await c.call("CAk" + n, "closed-offer-choice", { Digits: "1" }, `p=${p()}&d=2027-01-16`))).toBe(`date?p=${p()}`);
    expect((await getSession("CAk" + n))!.data.spanDays ?? {}).toEqual({});
  });
});

describe("item 27: the keypad card retry never starts a new card try after the Shabbes cut-off", () => {
  const PAY_ENV = { STRIPE_PHONE_PAY_MODE: "owner_test", TWILIO_PAY_ACCOUNT_SID: "ACpay", TWILIO_PAY_AUTH_TOKEN: "pay-token", TWILIO_PAY_SIP_DOMAIN: "hupup-pay.sip.twilio.com", TWILIO_PAY_SIP_USERNAME: "hotline", TWILIO_PAY_SIP_PASSWORD: "pw", AUTH_SECRET: "test-secret-0123456789abcdef" };
  const saved: Record<string, string | undefined> = {};
  beforeAll(() => {
    for (const [k, v] of Object.entries(PAY_ENV)) (saved[k] = process.env[k]), (process.env[k] = v);
  });
  afterAll(() => {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  });
  async function declined() {
    const { handlePayVoice, _payLegToken } = await import("@/lib/stripe-pay-voice");
    const [o] = await db.insert(schema.orders).values({ status: "PENDING_PAYMENT", channel: "PHONE", eventDate: "2027-01-17", pickupDate: "2027-01-18", deliveryAddress: "12 Forest Road, Monroe", subtotalCents: 20000, deliveryZone: "area", deliveryFeeCents: 1500, taxPercent: "8.125", taxCents: 1747, totalCents: 23247, holdExpiresAt: new Date(Date.now() + 3600_000) }).returning();
    const sub = (action: string, body: Record<string, string>, q: string) => handlePayVoice(action, new URLSearchParams(q), { AccountSid: "ACpay", CallSid: "CApay27", ...body });
    const q = `o=${o.id}&n=1&t=${_payLegToken(o.id, "CApay27")}`;
    return { o, sub, q };
  }
  it("Friday 10 AM: a declined card offers 'press 1 to try again'; 1 starts the second try (<Pay>)", async () => {
    at("2027-01-15T15:00:00Z");
    const { sub, q } = await declined();
    const after = await sub("result", { Result: "payment-connector-error", PaymentError: "card_declined" }, q);
    expect(after).toContain("/retry?");
    const again = await sub("retry", { Digits: "1" }, q);
    expect(again).toMatch(/<Pay [^>]*paymentConnector=/);
  });
  it("Friday 4:30 PM (after the cut-off): 1 never starts a new card try (back to the hotline call, which plays the cut-off)", async () => {
    at("2027-01-15T21:30:00Z");
    const { sub, q } = await declined();
    const again = await sub("retry", { Digits: "1" }, q);
    expect(again).not.toContain("<Pay");
    expect(again).toContain("<Hangup/>");
  });
  it("2, no key, or a forged link: no new try either", async () => {
    at("2027-01-15T15:00:00Z");
    const { sub, q, o } = await declined();
    for (const body of [{ Digits: "2" }, {}, { Digits: "9" }]) expect(await sub("retry", body, q)).not.toContain("<Pay");
    expect(await sub("retry", { Digits: "1" }, `o=${o.id}&n=1&t=forged`)).not.toContain("<Pay");
  });
});

describe("item 13: a caller waiting for staff with hold music is never cut off by the Shabbes check", () => {
  it("Friday 4:30 PM, with a cart: the wait keeps playing (no closed greeting, no Record inside the queue wait); a booking step is cut off", async () => {
    await freeStock();
    const c = caller();
    at("2027-01-15T21:22:00Z");
    const sid = "CAl" + n;
    await c.cart(sid, "2027-01-17");
    at("2027-01-15T21:30:00Z");
    const wait = await c.call(sid, "staff-hold", { QueueTime: "30" }, "k=0");
    expect(wait).not.toContain("<Record");
    expect(wait).not.toContain("closed now for Shabbes");
    expect(wait).not.toContain("save your items");
    expect(wait).toMatch(/<Play>|<Pause/);
    expect(await c.call(sid, "staff-queue-exit", { QueueResult: "bridged" }, "k=0")).toContain("<Hangup/>");
    expect(say(await c.call(sid, "cart"))).toContain("We will save your items until one hour after Shabbes");
  });
});

describe("item 26: the hold-music safety limit counts the staff accept waits", () => {
  it("still in the queue a little past the old limit; out to voicemail past the new one", async () => {
    const { getSettings } = await import("@/lib/settings");
    const { ringAttempts, ringListFor } = await import("@/lib/ivr/routing");
    const s = await getSettings();
    const list = ringListFor(s as never, "0");
    const rounds = (list.mode === "simultaneous" ? 1 : Math.max(1, list.targets.length)) * ringAttempts(s as never, "0");
    const ring = Math.max(20, ...list.targets.map((t) => t.ringSeconds));
    const oldLimit = ring * rounds + 60;
    const newLimit = (ring + 8 + 6 + 10) * rounds + 60;
    const c = caller();
    at("2027-01-13T17:00:00Z"); // an open weekday
    await ensureSession("CAm" + n, c.from);
    const stay = await c.call("CAm" + n, "staff-hold", { QueueTime: String(oldLimit + 5) }, "k=0");
    expect(stay).not.toContain("<Leave");
    expect(await c.call("CAm" + n, "staff-hold", { QueueTime: String(newLimit) }, "k=0")).not.toContain("<Leave");
    expect(await c.call("CAm" + n, "staff-hold", { QueueTime: String(newLimit + 1) }, "k=0")).toContain("<Leave");
    expect(redirect(await c.call("CAm" + n, "staff-queue-exit", { QueueResult: "leave" }, "k=0"))).toBe("voicemail?x=0");
  });
});

describe("item 25: two staff phones ending at the same moment never stall the rounds", () => {
  it("both legs come off the list; with no more rounds the caller is sent on to voicemail (missed: no answer)", async () => {
    const c = caller();
    at("2027-01-13T17:00:00Z");
    const sid = "CAn" + n;
    await ensureSession(sid, c.from);
    await updateSession(sid, { data: { staffLegs: ["CAleg1", "CAleg2"] } });
    const q = `c=${sid}&k=0&i=99`; // the last round already rang
    await Promise.all([handleVoice({ action: "staff-leg-status", query: new URLSearchParams(q), body: { CallSid: "CAleg1" }, callSid: "CAleg1", from: "+18455550001" }), handleVoice({ action: "staff-leg-status", query: new URLSearchParams(q), body: { CallSid: "CAleg2" }, callSid: "CAleg2", from: "+18455550002" })]);
    const s = await getSession(sid);
    expect(s!.data.staffLegs).toEqual([]);
    expect(s!.data.missed).toBe("no_answer");
  });
  it("one leg of two ending: the other is still ringing, nothing moves on", async () => {
    const c = caller();
    const sid = "CAo" + n;
    await ensureSession(sid, c.from);
    await updateSession(sid, { data: { staffLegs: ["CAleg3", "CAleg4"] } });
    await handleVoice({ action: "staff-leg-status", query: new URLSearchParams(`c=${sid}&k=0&i=99`), body: { CallSid: "CAleg3" }, callSid: "CAleg3", from: "+18455550003" });
    const s = await getSession(sid);
    expect(s!.data.staffLegs).toEqual(["CAleg4"]);
    expect(s!.data.missed).toBeUndefined();
  });
});
