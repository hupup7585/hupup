import { beforeAll, describe, expect, it, vi } from "vitest";

/* Audit H1 (Nov 24, 2026): Box 18 key 2 ("next day too") is its own rental: held through its own pickup, 1.5x only on it. */
const h = vi.hoisted(() => ({
  session: { callSid: "CAauditH1", fromNumber: "+18455550122", orderId: null as number | null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing" },
}));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/session", () => ({
  ensureSession: async () => h.session,
  getSession: async () => h.session,
  updateSession: async (_sid: string, patch: Record<string, unknown> & { data?: Record<string, unknown> }) =>
    Object.assign(h.session, { ...patch, data: { ...h.session.data, ...(patch.data ?? {}) } }),
}));
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));
vi.mock("@/lib/business-hours", async (orig) => ({ ...(await orig<typeof import("@/lib/business-hours")>()), officeOpenNow: () => true, lateHoursToday: () => null }));
vi.mock("@/lib/notify", () => ({ sendSms: async () => ({ sent: true }), sendEmail: async () => ({ sent: true }), sendMessage: async () => ({ sent: true }) }));

import { handleVoice } from "@/lib/ivr/flow";
import { db, schema } from "@/lib/db";
import { eq, inArray } from "drizzle-orm";
import { checkBookable } from "@/lib/availability";
import { reserveItem } from "@/lib/orders";

const call = (action: string, body: Record<string, string> = {}, query = "") =>
  handleVoice({ action, query: new URLSearchParams(query), body: { CallSid: h.session.callSid, ...body }, callSid: h.session.callSid, from: "+18455550122" });

const T = "2026-12-29"; // a Tuesday; Wednesday is open
const W = "2026-12-30";
let a = 0; // item A, plenty in stock
let b = 0; // item B, only one
const orderOf = async (id: number) => (await db.select().from(schema.orders).where(eq(schema.orders.id, id)))[0];

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  process.env.AUTH_SECRET = "test-secret";
  const [c] = await db.insert(schema.categories).values({ name: "Paddle Boats", spokenName: "Paddle Boats", ivrDigit: 3, sortOrder: 3, active: true }).returning();
  a = (await db.insert(schema.products).values({ categoryId: c.id, name: "paddle boat", priceCents: 10000, quantity: 5, active: true, sortOrder: 1 }).returning())[0].id;
  b = (await db.insert(schema.products).values({ categoryId: c.id, name: "big boat", priceCents: 20000, quantity: 1, active: true, sortOrder: 2 }).returning())[0].id;
  h.session.orderId = null;
  h.session.data = {};
});

describe("Box 18: key 1 and key 2 on the same date", () => {
  it("A with key 1, then B with key 2: B on its own order, held through its pickup; A charged one day", async () => {
    await call("box18-choice", { Digits: "1" }, `p=${a}&d=${T}&t=1`);
    await call("add", {}, `p=${a}&d=${T}&q=1`);
    const aOrder = h.session.orderId!;
    await call("box18-choice", { Digits: "2" }, `p=${b}&d=${T}&t=1`);
    await call("add", {}, `p=${b}&d=${T}&q=1`);
    const bOrder = h.session.orderId!;
    expect(bOrder).not.toBe(aOrder);
    const [oa, ob] = [await orderOf(aOrder), await orderOf(bOrder)];
    expect(oa.spanDays).toBeNull();
    expect(oa.subtotalCents).toBe(10000); // A: one day, never 1.5x
    expect(ob.spanDays).toBe(1.5);
    expect(ob.pickupDate > W).toBe(true); // B picked up after Wednesday
    const items = await db.select().from(schema.orderItems).where(inArray(schema.orderItems.orderId, [aOrder, bOrder]));
    expect(items.filter((i) => i.orderId === aOrder).map((i) => i.productId)).toEqual([a]);
    expect(items.filter((i) => i.orderId === bOrder).map((i) => i.productId)).toEqual([b]);
  });
  it("B is out on Wednesday: a second caller booking B for Wednesday is refused", async () => {
    expect(await checkBookable(b, 1, W, db)).toBe(0);
    const r = await reserveItem({ orderId: null, productId: b, qty: 1, eventDate: W, channel: "PHONE", holdExpiresAt: new Date(Date.now() + 600_000), callSid: "CAother" });
    expect(r).toMatchObject({ ok: false, reason: "unavailable" });
  });
  it("after key 2, a later key 1 item for the same date goes on the one-day order, not stretched", async () => {
    const before = await db.select().from(schema.orders).where(eq(schema.orders.eventDate, T));
    await call("box18-choice", { Digits: "1" }, `p=${a}&d=${T}&t=1`);
    expect((h.session.data.spanDays as Record<string, unknown> | undefined)?.[T]).toBeUndefined();
    await call("add", {}, `p=${a}&d=${T}&q=1`);
    const o = await orderOf(h.session.orderId!);
    expect(o.spanDays).toBeNull();
    expect(o.subtotalCents).toBe(20000); // two A at one day each
    expect((await db.select().from(schema.orders).where(eq(schema.orders.eventDate, T))).length).toBe(before.length);
  });
});
