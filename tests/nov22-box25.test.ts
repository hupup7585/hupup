import { beforeAll, describe, expect, it, vi } from "vitest";

/* Abraham, Nov 22, 2026 (after 3:13 PM): box 25 second one for laser tag and paddle boats, list openings, one item in the cart, shared pieces and the new slots. */
const h = vi.hoisted(() => ({
  session: { callSid: "CAbox25", fromNumber: "+18455550122", orderId: null as number | null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing" },
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
import { eq } from "drizzle-orm";

const call = (action: string, body: Record<string, string> = {}, query = "") =>
  handleVoice({ action, query: new URLSearchParams(query), body: { CallSid: h.session.callSid, ...body }, callSid: h.session.callSid, from: "+18455550122" });
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace("https://hupup.example/api/voice/", "").replace(/&amp;/g, "&");
const said = (xml: string) => [...xml.matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => m[1].replace(/&apos;/g, "'").replace(/&amp;/g, "&"));

const D1 = "2026-12-22";
const D2 = "2026-12-23";
let castle = 0;
let boat = 0;
let cat = 0;
let laserCat = 0;
let guns = 0;

async function hold(eventDate: string, lines: [number, number][]) {
  const [o] = await db.insert(schema.orders).values({ eventDate, pickupDate: eventDate, status: "HOLD", channel: "phone", subtotalCents: 0, holdExpiresAt: new Date(Date.now() + 3_600_000) } as never).returning();
  for (const [productId, qty] of lines) await db.insert(schema.orderItems).values({ orderId: o.id, productId, qty, unitPriceCents: 10000 } as never);
  const { refreshOrderTotals } = await import("@/lib/orders");
  await refreshOrderTotals(o.id);
  return o.id;
}
async function freshCart() {
  const a = await hold(D1, [[castle, 1], [boat, 2]]);
  const b = await hold(D2, [[castle, 1]]);
  h.session.orderId = null;
  h.session.data = { dayOrderIds: [a, b] };
  return [a, b];
}

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  process.env.AUTH_SECRET = "test-secret";
  const [c] = await db.insert(schema.categories).values({ name: "Paddle Boats", spokenName: "Paddle Boats", ivrDigit: 3, sortOrder: 3, active: true }).returning();
  cat = c.id;
  const [p2] = await db.insert(schema.products).values({ categoryId: c.id, name: "paddle boat", priceCents: 10000, quantity: 2, active: true, sortOrder: 1 }).returning();
  boat = p2.id;
  const [l] = await db.insert(schema.categories).values({ name: "Laser Tag", spokenName: "Laser Tag", ivrDigit: 2, sortOrder: 2, active: true }).returning();
  laserCat = l.id;
  const [g] = await db.insert(schema.products).values({ categoryId: l.id, name: "6 Laser Guns", priceCents: 11000, quantity: 1, active: true, sortOrder: 1 }).returning();
  guns = g.id;
  const [p1] = await db.insert(schema.products).values({ categoryId: c.id, name: "Castle Combo", priceCents: 10000, quantity: 5, active: false, sortOrder: 9 }).returning();
  castle = p1.id;
});

describe("box 25 for laser tag and paddle boats (Nov 22, 2026)", () => {
  it("the added line, the second one while another is free, stay on the line; no key goes on to keep shopping", async () => {
    h.session.orderId = null;
    h.session.data = {};
    expect(redirect(await call("add", {}, `p=${boat}&d=${D1}&q=1`))).toBe(`added-second?p=${boat}&d=${D1}&q=1`);
    const xml = await call("added-second", {}, `p=${boat}&d=${D1}&q=1`);
    expect(said(xml)).toEqual(["Successfully added to your cart: 1 paddle boat for Tuesday, December twenty-second.", "To add a second one, press 1.", "Otherwise, stay on the line."]);
    expect(xml).toMatch(/<Gather [^>]*timeout="4"/);
    expect(redirect(xml)).toBe(`added-rest?p=${boat}&d=${D1}`);
    expect(said(await call("added-rest", {}, `p=${boat}&d=${D1}`))).toEqual(["To keep shopping, for same day, press 1. For another day, press 2.", "To go to your shopping cart, press 0.", "To go back, press star."]);
    expect(redirect(await call("after-add", { Digits: "1" }))).toBe("cats");
    // 1 adds a second one; no third offer (and never how many are left)
    expect(redirect(await call("second-choice", { Digits: "1" }, `p=${boat}&d=${D1}`))).toBe(`add?p=${boat}&d=${D1}&q=1`);
    await call("add", {}, `p=${boat}&d=${D1}&q=1`);
    const again = await call("added-second", {}, `p=${boat}&d=${D1}&q=1`);
    expect(redirect(again)).toBe(`added-rest?p=${boat}&d=${D1}&q=1`);
    expect(said(await call("added-rest", {}, `p=${boat}&d=${D1}&q=1`))[0]).toBe("Successfully added to your cart: 1 paddle boat for Tuesday, December twenty-second.");
  });
  it("laser tag: no second one when none is free; its own recording otherwise", async () => {
    h.session.orderId = null;
    h.session.data = {};
    await call("add", {}, `p=${guns}&d=${D2}&q=1`);
    expect(redirect(await call("added-second", {}, `p=${guns}&d=${D2}&q=1`))).toBe(`added-rest?p=${guns}&d=${D2}&q=1`); // only one set
    const { PROMPTS } = await import("@/lib/ivr/prompts");
    expect(PROMPTS.second_laser.text).toBe("To add a second one, press 1.");
    expect(PROMPTS.second_paddle.text).toBe("To add a second one, press 1.");
  });
});

describe("list openings and one item in the cart", () => {
  it("laser tag and paddle boat lists open with their line", async () => {
    expect(said(await call("category", {}, `c=${laserCat}`))[0]).toBe("Here are our laser tag sets.");
    expect(said(await call("category", {}, `c=${cat}`))[0]).toBe("Here are our paddle boat packages.");
  });
  it("one item: 'You have in your cart one, item.'", async () => {
    const a = await hold(D1, [[boat, 1]]);
    h.session.orderId = null;
    h.session.data = { dayOrderIds: [a] };
    expect(said(await call("remove"))[0]).toBe("You have in your cart one, item.");
  });
});

describe("Admin slots (Nov 22, 2026)", () => {
  it("every new recording has a slot; the shared 'for' is listed once", async () => {
    const { allSlots } = await import("@/lib/recording-slots");
    const slots = allSlots();
    const keys = slots.map((x) => x.key);
    for (const k of ["laser_open", "paddle_open", "second_laser", "second_paddle", "stay_on_line", "box25_keep", "piece:one_item", "piece:for", "closed_book_it", "closed_pick_another", "box18_other_date", "addr_house", "pound_done", "addr_unit", "addr_unit_skip", "addr_zip", "field_unclear", "address_keypad_help"]) expect(keys, k).toContain(k);
    const text = (k: string) => slots.find((x) => x.key === k)?.text;
    expect(text("piece:one_item")).toBe("one, item");
    expect([text("box18_book#1"), text("box18_book#3"), text("box18_second#1"), text("box18_second#2"), text("box18_second#3")]).toEqual(["To book the", "press 1.", "To add it also for", "for only", "more, press 2."]);
    expect([text("closed_day_intro#1"), text("closed_day_get#1"), text("closed_day_get#2"), text("closed_day_get#3")]).toEqual(["We are closed on", "You can get it the day before, on", "and keep it until", "at 9:00 AM, for a total of"]);
    expect(keys).not.toContain("box18_book#2");
    expect(keys).not.toContain("closed_day_intro#2");
    expect(slots.filter((x) => x.text === "for" && /^(closed_day_intro|box18_book|box25_added)#/.test(x.key))).toHaveLength(0);
    expect(keys).not.toContain("remove_count_one");
  });
});
