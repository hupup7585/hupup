import { beforeAll, describe, expect, it, vi } from "vitest";

/* Deep check Nov 27, 9:00 AM, P17 (simulated call): Box 18 key 2 ("the next day too", 1.5x) is for the item it was
   offered for. A later item for the same day, chosen from the item list (the date step is skipped), used to join that
   1.5x rental without the caller being asked or told the price. Now it is booked for that date only. P21: a wrong key on
   an item list keeps the "free that date" filter. */
const h = vi.hoisted(() => ({
  session: { callSid: "CAp17", fromNumber: "+18455550133", orderId: null as number | null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing" },
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
vi.mock("@/lib/hours-schedule", async (orig) => ({ ...(await orig<typeof import("@/lib/hours-schedule")>()), lineOpen: () => true }));
vi.mock("@/lib/notify", () => ({ sendSms: async () => ({ sent: true }), sendEmail: async () => ({ sent: true }), sendMessage: async () => ({ sent: true }) }));

import { eq } from "drizzle-orm";
import { handleVoice } from "@/lib/ivr/flow";
import { db, schema } from "@/lib/db";

const call = (action: string, body: Record<string, string> = {}, query = "") =>
  handleVoice({ action, query: new URLSearchParams(query), body: { CallSid: h.session.callSid, ...body }, callSid: h.session.callSid, from: "+18455550133" });
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace(/^.*\/api\/voice\//, "").replace(/&amp;/g, "&");
const orderOf = async (id: number) => (await db.select().from(schema.orders).where(eq(schema.orders.id, id)))[0];

const T = "2026-12-29"; // a Tuesday; Wednesday is open
let cat = 0;
let castle = 0;
let boat = 0;
beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  process.env.AUTH_SECRET = "test-secret";
  const [c] = await db.insert(schema.categories).values({ name: "Paddle Boats", spokenName: "Paddle Boats", ivrDigit: 3, sortOrder: 3, active: true }).returning();
  cat = c.id;
  castle = (await db.insert(schema.products).values({ categoryId: c.id, name: "big boat", priceCents: 20000, quantity: 3, active: true, sortOrder: 1 }).returning())[0].id;
  boat = (await db.insert(schema.products).values({ categoryId: c.id, name: "paddle boat", priceCents: 10000, quantity: 5, active: true, sortOrder: 2 }).returning())[0].id;
  h.session.orderId = null;
  h.session.data = {};
});

describe("deep check 09:00 P17: Box 18 key 2 stays with its item", () => {
  it("item 1 with key 2 (1.5x), then item 2 picked from the list for the same day: item 2 one day, its own pickup", async () => {
    expect(redirect(await call("box18-choice", { Digits: "2" }, `p=${castle}&d=${T}&t=1`))).toBe(`qty?p=${castle}&d=${T}`);
    await call("add", {}, `p=${castle}&d=${T}&q=1`);
    const spanOrder = h.session.orderId!;
    expect((await orderOf(spanOrder)).spanDays).toBe(1.5);
    // keep shopping: the item list for the same category, key 2 = the paddle boat; the date step is skipped
    expect(redirect(await call("category-choice", { Digits: "2" }, `c=${cat}`))).toBe(`qty?p=${boat}&d=${T}`);
    await call("add", {}, `p=${boat}&d=${T}&q=1`);
    const boatOrder = h.session.orderId!;
    expect(boatOrder).not.toBe(spanOrder);
    const ob = await orderOf(boatOrder);
    expect(ob.spanDays).toBeNull();
    expect(ob.subtotalCents).toBe(10000); // one day, never 1.5x
    const os = await orderOf(spanOrder);
    expect(os.spanDays).toBe(1.5); // item 1 keeps its next day
    expect(ob.pickupDate < os.pickupDate).toBe(true);
    const lines = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, spanOrder));
    expect(lines.map((l) => l.productId)).toEqual([castle]);
  });

  it("P21: a wrong key on the 'free that date' item list replays that list, filter kept", async () => {
    const r = redirect(await call("category-choice", { Digits: "9" }, `c=${cat}&f=${T}`));
    expect(r).toBe(`category?c=${cat}&f=${T}`);
  });
});
