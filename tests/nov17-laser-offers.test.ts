import { beforeAll, describe, expect, it, vi } from "vitest";

/* Laser tag and offers (Abraham's answers, Nov 17, 2026). In-memory database; nothing is dialed or charged. */
const h = vi.hoisted(() => ({
  session: { callSid: "CAlaser", fromNumber: "+18455550199", orderId: null as number | null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing", startedAt: new Date() },
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
vi.mock("@/lib/notify", () => ({ sendSms: async () => ({ sent: true }), sendEmail: async () => ({ sent: true }) }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { reserveItem, refreshOrderTotals } from "@/lib/orders";
import { saveSetting } from "@/lib/settings";
import { handleVoice } from "@/lib/ivr/flow";
import { deliveryFeeFor } from "@/lib/offer-delivery";
import { OFFER_NOTES } from "@/lib/offers";

const call = (action: string, body: Record<string, string> = {}, q = "") =>
  handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: "CAlaser", ...body }, callSid: "CAlaser", from: "+18455550199" });
const said = (xml: string) => [...xml.matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => m[1].replace(/&apos;/g, "'"));
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace(/^.*\/api\/voice\//, "").replace(/&amp;/g, "&");

let maze6 = 0, maze4 = 0, guns6 = 0, balloon = 0;
const ids = { pack6: 0, pack4: 0 };

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  const [laser] = await db.insert(schema.categories).values({ name: "Laser Tag and Inflatable Mazes", ivrDigit: 2, sortOrder: 2, active: true }).returning();
  const [bounce] = await db.insert(schema.categories).values({ name: "Jumping Balloons", ivrDigit: 1, sortOrder: 1, active: true }).returning();
  const [a, b, c] = await db
    .insert(schema.products)
    .values([
      { categoryId: laser.id, name: "Inflatable Maze with 6 Laser Guns", priceCents: 20000, quantity: 1, active: true, stockGroup: "maze" },
      { categoryId: laser.id, name: "Inflatable Maze with 4 Laser Guns", priceCents: 17500, quantity: 1, active: true, stockGroup: "maze" },
      { categoryId: laser.id, name: "6 Laser Guns", priceCents: 11000, quantity: 3, active: true },
    ])
    .returning();
  [maze6, maze4, guns6] = [a.id, b.id, c.id];
  const [bl] = await db.insert(schema.products).values({ categoryId: bounce.id, name: "Soft Hop", priceCents: 6500, quantity: 5, active: true }).returning();
  balloon = bl.id;
  // The add-on packs, as the migration sets them up (a hidden group, 6-pack first)
  const [addons] = await db.select().from(schema.categories).where(eq(schema.categories.name, "Laser tag add-ons"));
  const [p6, p4] = await db
    .insert(schema.products)
    .values([
      { categoryId: addons.id, name: "Additional 6-Pack Laser Guns", priceCents: 7500, quantity: 10, sizeOrder: 1, active: true },
      { categoryId: addons.id, name: "Additional 4-Pack Laser Guns", priceCents: 5000, quantity: 10, sizeOrder: 2, active: true },
    ])
    .returning();
  ids.pack6 = p6.id;
  ids.pack4 = p4.id;
});

describe("one maze", () => {
  it("both maze items share it: once one is booked for a day, neither can be booked that day", async () => {
    const r1 = await reserveItem({ orderId: null, productId: maze6, qty: 1, eventDate: "2026-12-07", channel: "POS", status: "CONFIRMED" });
    expect(r1.ok).toBe(true);
    const r2 = await reserveItem({ orderId: null, productId: maze4, qty: 1, eventDate: "2026-12-07", channel: "POS", status: "CONFIRMED" });
    expect(r2).toMatchObject({ ok: false, reason: "unavailable" });
    expect((await reserveItem({ orderId: null, productId: maze4, qty: 1, eventDate: "2026-12-09", channel: "POS", status: "CONFIRMED" })).ok).toBe(true);
  });
  it("the add-on packs are a hidden group (off the item list)", async () => {
    const [c] = await db.select().from(schema.categories).where(eq(schema.categories.name, "Laser tag add-ons"));
    expect(c.active).toBe(false);
    expect(c.ivrDigit).toBeNull();
  });
});

describe("laser tag third pack 50% off (Owner switch)", () => {
  it("off: full price; on: maze with 6 guns $200 + 6-pack $75 + 6-pack $37.50", async () => {
    const r = await reserveItem({ orderId: null, productId: maze6, qty: 1, eventDate: "2026-12-14", channel: "POS", status: "CONFIRMED" });
    if (!r.ok) throw new Error("no order");
    await reserveItem({ orderId: r.orderId, productId: ids.pack6, qty: 2, eventDate: "2026-12-14", channel: "POS", status: "CONFIRMED" });
    let [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, r.orderId));
    expect(o.subtotalCents).toBe(35000);
    await saveSetting("offerLaserThirdPackOn", true);
    await refreshOrderTotals(r.orderId);
    [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, r.orderId));
    expect(o.subtotalCents).toBe(31250);
    expect(o.offerNote).toBe(OFFER_NOTES.laser);
    // a 4th pack does not get 50% off (only the 3rd)
    await reserveItem({ orderId: r.orderId, productId: ids.pack4, qty: 1, eventDate: "2026-12-14", channel: "POS", status: "CONFIRMED" });
    [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, r.orderId));
    expect(o.subtotalCents).toBe(31250 + 5000);
    await saveSetting("offerLaserThirdPackOn", false);
  });
  it("guns only count too: 6 guns + two 6-packs, the 3rd pack half off", async () => {
    await saveSetting("offerLaserThirdPackOn", true);
    const r = await reserveItem({ orderId: null, productId: guns6, qty: 1, eventDate: "2026-12-21", channel: "POS", status: "CONFIRMED" });
    if (!r.ok) throw new Error("no order");
    await reserveItem({ orderId: r.orderId, productId: ids.pack6, qty: 2, eventDate: "2026-12-21", channel: "POS", status: "CONFIRMED" });
    const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, r.orderId));
    expect(o.subtotalCents).toBe(11000 + 7500 + 3750);
    await saveSetting("offerLaserThirdPackOn", false);
  });
});

describe("Thursday to Sunday (Owner switch)", () => {
  it("delivered Thursday, picked up Monday: 1.5 times the rental; off = regular", async () => {
    const thu = "2026-12-17"; // not in Chanukah (no offers then, Abraham Nov 18, 2026)
    const r = await reserveItem({ orderId: null, productId: balloon, qty: 1, eventDate: thu, pickupDate: "2026-12-21", channel: "POS", status: "CONFIRMED" });
    if (!r.ok) throw new Error("no order");
    let [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, r.orderId));
    expect(o.subtotalCents).toBe(6500);
    await saveSetting("offerThuSunOn", true);
    await refreshOrderTotals(r.orderId);
    [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, r.orderId));
    expect(o.subtotalCents).toBe(9750);
    expect(o.offerNote).toBe(OFFER_NOTES.thuSun);
    await saveSetting("offerThuSunOn", false);
  });
});

describe("4th Sunday free (Owner switch)", () => {
  it("3 Sundays in a row booked: the 4th Sunday's rental is free (the cheapest item); delivery $20 / $30 / $40", async () => {
    const [c] = await db.insert(schema.customers).values({ phone: "+18455550444", name: "Sunday Customer" }).returning();
    for (const d of ["2027-01-03", "2027-01-10", "2027-01-17"]) {
      const r = await reserveItem({ orderId: null, productId: balloon, qty: 1, eventDate: d, channel: "POS", status: "CONFIRMED" });
      if (r.ok) await db.update(schema.orders).set({ customerId: c.id }).where(eq(schema.orders.id, r.orderId));
    }
    const r4 = await reserveItem({ orderId: null, productId: balloon, qty: 1, eventDate: "2027-01-24", channel: "POS", status: "CONFIRMED" });
    if (!r4.ok) throw new Error("no order");
    await db.update(schema.orders).set({ customerId: c.id }).where(eq(schema.orders.id, r4.orderId));
    await saveSetting("offerFourthSundayOn", true);
    await refreshOrderTotals(r4.orderId);
    const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, r4.orderId));
    expect(o.subtotalCents).toBe(0);
    expect(o.offerNote).toBe(OFFER_NOTES.fourthSunday);
    expect([deliveryFeeFor("local", {}, "2027-01-24", o.offerNote), deliveryFeeFor("area", {}, "2027-01-24", o.offerNote), deliveryFeeFor("outside", {}, "2027-01-24", o.offerNote)]).toEqual([2000, 3000, 4000]);
    // a gap (no booking the Sunday before) means no free Sunday
    const r5 = await reserveItem({ orderId: null, productId: balloon, qty: 1, eventDate: "2027-02-07", channel: "POS", status: "CONFIRMED" });
    if (!r5.ok) throw new Error("no order");
    await db.update(schema.orders).set({ customerId: c.id }).where(eq(schema.orders.id, r5.orderId));
    await refreshOrderTotals(r5.orderId);
    const [o5] = await db.select().from(schema.orders).where(eq(schema.orders.id, r5.orderId));
    expect(o5.subtotalCents).toBe(6500);
    await saveSetting("offerFourthSundayOn", false);
  });
});

describe("phone: extra laser gun packs after a maze or guns (approved Nov 17)", () => {
  it("after the guns: the item added line, then the packs question; 1 adds a 6-pack to the same day", async () => {
    const day = "2026-12-28";
    const add = await call("add", {}, `p=${guns6}&d=${day}&q=1`);
    // Box 151 says the item was added (Nov 19, 2026)
    expect(said(await call("another", {}, `p=${guns6}&d=${day}`))[0]).toMatch(/has been successfully added to your cart\./);
    // Nov 19, 2026: laser tag plays box 151 first; staying on the line goes on to the packs
    expect(redirect(add)).toBe(`another?p=${guns6}&d=${day}`);
    expect(redirect(await call("another-done", {}, `p=${guns6}&d=${day}`))).toBe(`packs?d=${day}`);
    expect(said(await call("packs", {}, `d=${day}`))).toEqual(["Would you like to add more laser guns? To add a 6-pack of laser guns for $75, press 1. To add a 4-pack of laser guns for $50, press 2. To skip, press pound.", "To go to your shopping cart, press 0.", "To go back, press star."]);
    const r = await call("packs-choice", { Digits: "1" }, `d=${day}`);
    expect(redirect(r)).toBe("added-menu"); // row 11 after a pack is added (Nov 19, 2026)
    const items = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, h.session.orderId!));
    expect(items.map((i) => i.productId)).toContain(ids.pack6);
    expect(redirect(await call("packs-choice", { Digits: "#" }, `d=${day}`))).toBe("added-menu");
  });
  it("approved (box 25b): the packs question plays on the live line too", async () => {
    process.env.VERCEL_ENV = "production";
    const add = await call("add", {}, `p=${guns6}&d=2026-12-29&q=1`);
    delete process.env.VERCEL_ENV;
    expect(redirect(add)).toBe(`another?p=${guns6}&d=2026-12-29`); // box 151 is approved: live too
    process.env.VERCEL_ENV = "production";
    try {
      expect(redirect(await call("another-done", {}, `p=${guns6}&d=2026-12-29`))).toBe("packs?d=2026-12-29");
    } finally {
      delete process.env.VERCEL_ENV;
    }
  });
});
