import { beforeAll, describe, expect, it, vi } from "vitest";

/* Hark for Abraham, Nov 24, 2026: laser pack offer after every laser item, ocean balls once per call, balls from the cart, offers check. */
const h = vi.hoisted(() => ({
  session: { callSid: "CAlaser24", fromNumber: "+18455550199", orderId: null as number | null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing", startedAt: new Date() },
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
  handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: "CAlaser24", ...body }, callSid: "CAlaser24", from: "+18455550199" });
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


const tens = async (orderId: number) => (await db.select().from(schema.orders).where(eq(schema.orders.id, orderId)))[0];

describe("2 (revised). additional packs only with a maze; the offer repeats after every pack", () => {
  // Nov 26, 2026: the packs question after a maze is replaced by the key 9 offer in box 25 (tests/nov26-laser-key9.test.ts)
  it("after a maze: box 25 offers a second six-pack on key 9; 9 adds it and the third is offered at half price", async () => {
    const day2 = "2027-03-02";
    h.session.orderId = null;
    h.session.data = {};
    expect(redirect(await call("add", {}, `p=${maze6}&d=${day2}&q=1`))).toBe(`added-menu?z=${day2}%3A6`);
    expect(said(await call("added-menu", {}, `z=${day2}:6`))[1]).toBe("To add a second six-pack of laser guns for $75, press 9.");
    expect(redirect(await call("after-add", { Digits: "9" }, `z=${day2}:6`))).toBe(`add?p=${ids.pack6}&d=${day2}&q=1`);
    await call("add", {}, `p=${ids.pack6}&d=${day2}&q=1`);
    expect(said(await call("added-menu", {}, `z=${day2}:6`))[1]).toBe("To add a third six-pack of laser guns for half price, only $37.50, press 9.");
  });
  it("plain 6 guns + an additional 6-pack is refused (server side), on the phone and the staff screen", async () => {
    const r = await reserveItem({ orderId: null, productId: guns6, qty: 1, eventDate: "2027-03-29", channel: "POS", status: "CONFIRMED" });
    if (!r.ok) throw new Error("no order");
    expect(await reserveItem({ orderId: r.orderId, productId: ids.pack6, qty: 1, eventDate: "2027-03-29", channel: "POS", status: "CONFIRMED" })).toMatchObject({ ok: false, reason: "needs_maze" });
    expect(await reserveItem({ orderId: null, productId: ids.pack6, qty: 1, eventDate: "2027-03-29", channel: "PHONE" })).toMatchObject({ ok: false, reason: "needs_maze" });
    const { createOrderWithItems } = await import("@/lib/orders");
    expect(await createOrderWithItems({ items: [{ productId: guns6, qty: 1 }, { productId: ids.pack6, qty: 1 }], eventDate: "2027-03-30", channel: "POS", status: "CONFIRMED" })).toMatchObject({ ok: false, reason: "needs_maze" });
    expect((await createOrderWithItems({ items: [{ productId: maze6, qty: 1 }, { productId: ids.pack6, qty: 2 }], eventDate: "2027-03-30", channel: "POS", status: "CONFIRMED" })).ok).toBe(true);
  });
  it("Nov 25, 2026, 15:06: removing the maze keeps its additional packs (guns) at the no-maze price", async () => {
    const day = "2027-06-14";
    h.session.orderId = null;
    h.session.data = {};
    await call("add", {}, `p=${maze6}&d=${day}&q=1`);
    await call("add", {}, `p=${ids.pack6}&d=${day}&q=1`);
    await call("add", {}, `p=${ids.pack4}&d=${day}&q=1`);
    const orderId = h.session.orderId!;
    const [mazeLine] = await db.select().from(schema.orderItems).where(eq(schema.orderItems.productId, maze6));
    const before = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, orderId));
    expect(before.length).toBe(3);
    const mz = before.find((i) => i.productId === maze6)!;
    void mazeLine;
    await call("remove-qty-choice", { Digits: "1" }, `i=${mz.id}`);
    const left = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, orderId));
    expect(left.map((l) => l.productId).sort()).toEqual([ids.pack6, ids.pack4].sort());
    expect(left.find((l) => l.productId === ids.pack6)!.unitPriceCents).toBe(11000); // the regular six-gun price
  });
});

describe("third laser pack half price (Abraham, Nov 24, 12:42 PM), the 3rd one added, the switch on", () => {
  let guns4 = 0;
  const book = async (date: string, list: number[]) => {
    let orderId: number | null = null;
    for (const productId of list) {
      const r = await reserveItem({ orderId, productId, qty: 1, eventDate: date, channel: "POS", status: "CONFIRMED" });
      if (!r.ok) throw new Error(`not booked: ${JSON.stringify(r)}`);
      orderId = r.orderId;
    }
    return (await tens(orderId!)).subtotalCents;
  };
  beforeAll(async () => {
    const [laser] = await db.select().from(schema.categories).where(eq(schema.categories.name, "Laser Tag and Inflatable Mazes"));
    guns4 = (await db.insert(schema.products).values({ categoryId: laser.id, name: "4 Laser Guns", priceCents: 7500, quantity: 7, active: true }).returning())[0].id;
    await db.update(schema.products).set({ quantity: 6 }).where(eq(schema.products.id, guns6));
  });
  // Nov 25, 2026, 4:03 PM: the maze is a full set, counted apart from the extra gun sets
  it("maze with 6 $200 + 6-pack $75 + 6-pack $37.50 = $312.50 (the maze's guns are the first set, Nov 26, 2026)", async () => {
    expect(await book("2027-05-03", [maze6, ids.pack6, ids.pack6])).toBe(31250);
  });
  it("maze with 6 $200 + 6-pack $75 + 4-pack $25 (the 3rd set) + 4-pack $50 = $350", async () => {
    expect(await book("2027-05-17", [maze6, ids.pack6, ids.pack4, ids.pack4])).toBe(35000);
  });
  it("no maze: 6 guns $110 + 6 guns $110 + 6 guns $55 = $275", async () => {
    expect(await book("2027-05-05", [guns6, guns6, guns6])).toBe(27500);
  });
  it("no maze: 6 guns $110 + 6 guns $110 + 4 guns $37.50 = $257.50 (the set added third is half, Nov 26, 2026)", async () => {
    expect(await book("2027-05-06", [guns6, guns6, guns4])).toBe(25750);
    expect(await book("2027-05-10", [guns6, guns4, guns6])).toBe(11000 + 7500 + 5500); // the third added, as the phone says
  });
  it("maze + 1 additional pack: no discount", async () => {
    expect(await book("2027-05-24", [maze6, ids.pack6])).toBe(27500);
  });
  it("4 plain packs: only the 3rd is half", async () => {
    expect(await book("2027-05-11", [guns6, guns6, guns6, guns6])).toBe(11000 * 3 + 5500);
  });
  it("in the item prices, never a separate offer", async () => {
    const { OFFER_NOTES } = await import("@/lib/offers");
    expect(OFFER_NOTES).not.toHaveProperty("laser");
  });
});

describe("3. ocean balls only after the first balloon of the call", () => {
  it("the first balloon: the balls offer; the second: straight on", async () => {
    const day = "2027-03-15";
    h.session.orderId = null;
    h.session.data = {};
    expect(redirect(await call("add", {}, `p=${balloon}&d=${day}&q=1`))).toBe(`added-menu?o=${day}`); // the offer (Nov 25, 2026, 14:08)
    expect(h.session.data.oceanOffered).toBe(true);
    expect(redirect(await call("add", {}, `p=${balloon}&d=${day}&q=1`))).toBe("added-menu");
  });
});

describe("4. ocean balls from the cart (Nov 25, 2026, 14:08: key 9, live)", () => {
  it("key 9 in the cart goes to the amounts and back to the cart", async () => {
    const day = "2027-03-22";
    h.session.orderId = null;
    h.session.data = { oceanOffered: true };
    await call("add", {}, `p=${balloon}&d=${day}&q=1`);
    expect(redirect(await call("cart-choice", { Digits: "9" }))).toBe(`ocean?d=${day}&n=cart`);
    expect(redirect(await call("ocean-choice", { Digits: "*" }, `d=${day}&n=cart`))).toBe("cart");
    expect(said(await call("cart")).join(" ")).toContain("To add ocean balls, press 9.");
  });
});

describe("5. offers check (the three switches on)", () => {
  it("laser every third set half price: maze with 6 $200 + 6-pack $75 + 4-pack $25 (the third set, Nov 26, 2026) = $300; a 4th set full price", async () => {
    const r = await reserveItem({ orderId: null, productId: maze6, qty: 1, eventDate: "2027-04-05", channel: "POS", status: "CONFIRMED" });
    if (!r.ok) throw new Error("no order");
    await reserveItem({ orderId: r.orderId, productId: ids.pack6, qty: 1, eventDate: "2027-04-05", channel: "POS", status: "CONFIRMED" });
    await reserveItem({ orderId: r.orderId, productId: ids.pack4, qty: 1, eventDate: "2027-04-05", channel: "POS", status: "CONFIRMED" });
    expect((await tens(r.orderId)).subtotalCents).toBe(30000);
    await reserveItem({ orderId: r.orderId, productId: ids.pack4, qty: 1, eventDate: "2027-04-05", channel: "POS", status: "CONFIRMED" });
    // the 4th set: full price
    expect((await tens(r.orderId)).subtotalCents).toBe(35000);
    // two packs only: no offer
    const r2 = await reserveItem({ orderId: null, productId: maze6, qty: 1, eventDate: "2027-04-12", channel: "POS", status: "CONFIRMED" });
    if (!r2.ok) throw new Error("no order");
    await reserveItem({ orderId: r2.orderId, productId: ids.pack6, qty: 1, eventDate: "2027-04-12", channel: "POS", status: "CONFIRMED" });
    expect((await tens(r2.orderId)).offerNote).toBeNull();
  });
  it("Thursday to Sunday: Bounce Blast $195 becomes $292.50; a shorter stretch is the day price", async () => {
    await saveSetting("offerThuSunOn", true);
    const [cat] = await db.select().from(schema.categories).where(eq(schema.categories.name, "Jumping Balloons"));
    const [bb] = await db.insert(schema.products).values({ categoryId: cat.id, name: "Bounce Blast", priceCents: 19500, quantity: 2, active: true }).returning();
    const r = await reserveItem({ orderId: null, productId: bb.id, qty: 1, eventDate: "2027-02-04", pickupDate: "2027-02-08", channel: "POS", status: "CONFIRMED" });
    if (!r.ok) throw new Error("no order");
    expect((await tens(r.orderId)).subtotalCents).toBe(29250);
    const r2 = await reserveItem({ orderId: null, productId: bb.id, qty: 1, eventDate: "2027-02-11", pickupDate: "2027-02-12", channel: "POS", status: "CONFIRMED" });
    if (!r2.ok) throw new Error("no order");
    expect((await tens(r2.orderId)).subtotalCents).toBe(19500);
    await saveSetting("offerThuSunOn", false);
  });
  it("no offer during Chanukah, and offers never combine", async () => {
    await saveSetting("offerThuSunOn", true);
    // Chanukah 2026: Thursday Dec 10 to Monday Dec 14
    const r = await reserveItem({ orderId: null, productId: balloon, qty: 1, eventDate: "2026-12-10", pickupDate: "2026-12-14", channel: "POS", status: "CONFIRMED" });
    if (!r.ok) throw new Error("no order");
    expect((await tens(r.orderId)).offerNote).not.toBe(OFFER_NOTES.thuSun);
    // laser sets on a Thursday-to-Sunday: one offer only (the third set's half price is in its item price)
    const r2 = await reserveItem({ orderId: null, productId: guns6, qty: 1, eventDate: "2027-02-18", pickupDate: "2027-02-22", channel: "POS", status: "CONFIRMED" });
    if (!r2.ok) throw new Error("no order");
    await reserveItem({ orderId: r2.orderId, productId: guns6, qty: 2, eventDate: "2027-02-18", channel: "POS", status: "CONFIRMED" });
    const o = await tens(r2.orderId);
    expect(o.offerNote).toBe(OFFER_NOTES.thuSun);
    expect(o.offerNote?.includes(";")).toBeFalsy();
    await saveSetting("offerThuSunOn", false);
  });
});
