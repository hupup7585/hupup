import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/* The phone's booking cut-off before Shabbes (Abraham, Nov 26, 2026, 11:51 PM): from 15 minutes before candle
   lighting no booking is finished and nothing is paid; a caller's cart is saved until 1 hour after the phone opens
   again; calling back, welcome back offers it; then it goes back to stock. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));
vi.mock("@/lib/notify", () => ({ sendSms: async () => ({ sent: true }), sendEmail: async () => ({ sent: true }) }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { handleCallStatus, handleVoice } from "@/lib/ivr/flow";
import { reserveItem } from "@/lib/orders";
import { getSettings } from "@/lib/settings";
import { bookingCutoff, bookingLock, erevCandleLighting } from "@/lib/jewish-calendar";
import { checkBookable } from "@/lib/availability";
import { ensureSession } from "@/lib/ivr/session";
const PINNED = process.env.HUP_CALENDAR_NOW; // the test setup's pinned day, put back after each test
afterAll(() => void (process.env.HUP_CALENDAR_NOW = PINNED));

const FROM = "+18455550615";
const call = (sid: string, action: string, body: Record<string, string> = {}, q = "") => handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: sid, ...body }, callSid: sid, from: FROM });
const said = (xml: string) => [...xml.matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => m[1].replace(/&apos;/g, "'")).join(" ");
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace(/^.*\/api\/voice\//, "").replace(/&amp;/g, "&");

let pid = 0, holdId = 0, candles: Date;
const EVENT = "2027-01-18"; // Monday
beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  delete process.env.VERCEL_ENV;
  const c = (await db.insert(schema.categories).values({ name: "Jumping Balloons", ivrDigit: 1, sortOrder: 1, active: true }).returning())[0].id;
  pid = (await db.insert(schema.products).values({ categoryId: c, name: "Castle Bouncer", priceCents: 12000, quantity: 1, active: true }).returning())[0].id;
  candles = erevCandleLighting("2027-01-15", (await getSettings()) as never)!; // Friday, January 15, 2027
});

describe("Shabbes cut-off", () => {
  it("the cut-off starts 15 minutes before candle lighting", async () => {
    const s = (await getSettings()) as never;
    expect(bookingCutoff(new Date(candles.getTime() - 16 * 60_000), s, 15).cut).toBe(false);
    expect(bookingCutoff(new Date(candles.getTime() - 14 * 60_000), s, 15).cut).toBe(true);
  });

  it("a caller with a cart at the cut-off: items saved until 1 hour after Shabbes, no payment, call ends; welcome back after Shabbes; then released", async () => {
    const sid = "CAcut1";
    await ensureSession(sid, FROM);
    const r = await reserveItem({ orderId: null, productId: pid, qty: 1, eventDate: EVENT, channel: "PHONE", status: "HOLD", holdExpiresAt: new Date(Date.now() + 10 * 60_000), callSid: sid });
    if (!r.ok) throw new Error("no hold");
    holdId = r.orderId;
    await db.update(schema.callSessions).set({ orderId: holdId, data: { dayOrderIds: [holdId] } }).where(eq(schema.callSessions.callSid, sid));

    process.env.HUP_CALENDAR_NOW = new Date(candles.getTime() - 14 * 60_000).toISOString();
    const xml = await call(sid, "cart");
    const until = new Date(bookingLock(candles, (await getSettings()) as never).opensAt!.getTime() + 60 * 60_000);
    const clock = until.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).replace(/\s*PM$/, "");
    expect(said(xml)).toBe(`Shabbes is starting soon, so we cannot finish your booking right now. We will save your items until one hour after Shabbes, Saturday night, at ${clock} PM. Please call us back right after Shabbes to finish your order. Thank you for calling Hup Up Attractions, a good Shabbes.`);
    expect(xml).toContain("<Hangup/>");
    const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, holdId));
    expect([o.status, o.holdExpiresAt?.getTime()]).toEqual(["HOLD", until.getTime()]);
    // paying is not possible after the cut-off
    const pay = await call(sid, "phonepay-go", {}, `o=${holdId}`);
    expect(pay).not.toContain("pay-leg");
    expect(pay).toContain("<Hangup/>");
    // hanging up keeps the saved cart
    await handleCallStatus(sid, "completed");
    expect((await db.select().from(schema.orders).where(eq(schema.orders.id, holdId)))[0].status).toBe("HOLD");
    expect(await checkBookable(pid, 1, EVENT)).toBe(0);

    // Saturday night, the phone open again and before the saved time: welcome back offers the cart
    process.env.HUP_CALENDAR_NOW = new Date(until.getTime() - 30 * 60_000).toISOString();
    const sid2 = "CAcut2";
    await call(sid2, "incoming");
    expect(redirect(await call(sid2, "book"))).toBe("resume");
    expect(said(await call(sid2, "resume"))).toContain("Castle Bouncer");
    expect(redirect(await call(sid2, "resume-choice", { Digits: "1" }))).toBe("resume-items");
    const s2 = (await db.select().from(schema.callSessions).where(eq(schema.callSessions.callSid, sid2)))[0];
    expect(s2.data?.resumeLines?.map((l) => l.state)).toEqual(["free"]);
    process.env.HUP_CALENDAR_NOW = PINNED;
  });

  it("the saved hold runs out: the items go back to stock", async () => {
    const [c] = await db.insert(schema.categories).values({ name: "Laser", sortOrder: 2, active: true }).returning();
    const [p] = await db.insert(schema.products).values({ categoryId: c.id, name: "Paddle boat", priceCents: 9000, quantity: 1, active: true }).returning();
    const [o] = await db.insert(schema.orders).values({ status: "HOLD", channel: "PHONE", eventDate: EVENT, pickupDate: "2027-01-19", holdExpiresAt: new Date(Date.now() + 60_000) }).returning();
    await db.insert(schema.orderItems).values({ orderId: o.id, productId: p.id, qty: 1, unitPriceCents: 9000 });
    expect(await checkBookable(p.id, 1, EVENT)).toBe(0);
    await db.update(schema.orders).set({ holdExpiresAt: new Date(Date.now() - 1000) }).where(eq(schema.orders.id, o.id));
    expect(await checkBookable(p.id, 1, EVENT)).toBe(1);
  });

  it("deep check 06:00 M45: a first item chosen after the cut-off (browsing started before it) is never put on hold", async () => {
    const sid = "CAcut45";
    await ensureSession(sid, FROM);
    process.env.HUP_CALENDAR_NOW = new Date(candles.getTime() - 10 * 60_000).toISOString();
    const xml = await call(sid, "add", {}, `p=${pid}&d=2027-01-25`);
    expect(said(xml)).toContain("We are closed now for Shabbes");
    const holds = await db.select().from(schema.orders).where(eq(schema.orders.eventDate, "2027-01-25"));
    expect(holds).toHaveLength(0);
    process.env.HUP_CALENDAR_NOW = PINNED;
  });
  it("an empty cart at the cut-off: the closed greeting, as today", async () => {
    process.env.HUP_CALENDAR_NOW = new Date(candles.getTime() - 10 * 60_000).toISOString();
    const xml = await call("CAcut3", "book");
    expect(said(xml)).toContain("We are closed now for Shabbes");
    expect(xml).toContain("<Record");
    process.env.HUP_CALENDAR_NOW = PINNED;
  });
});
