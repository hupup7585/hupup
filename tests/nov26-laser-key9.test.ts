import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Key 9 "add another laser set" (Abraham, Nov 26, 2026). Right after any laser set is added, box 25 offers one more,
 * before the same-day and another-day lines: the same size the caller just picked ("second" at the catalog price,
 * "third" at half price), else the other size with the sold-out line, else nothing; at most 3 sets. Every laser menu
 * on the phone works as spoken: each key does what its line says, the price said is the price charged, and the cart
 * total is what was said.
 */
const h = vi.hoisted(() => ({
  session: { callSid: "CAkey9", fromNumber: "+18455550177", orderId: null as number | null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing", startedAt: new Date() },
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
vi.mock("@/lib/jewish-calendar", async (orig) => ({ ...(await orig<typeof import("@/lib/jewish-calendar")>()), isShabbosOrYomTov: () => false, bookingLock: () => ({ locked: false }) }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { reserveItem } from "@/lib/orders";
import { saveSetting } from "@/lib/settings";
import { handleVoice } from "@/lib/ivr/flow";
import { PROMPTS, RETIRED_PROMPTS, promptArea } from "@/lib/ivr/prompts";

const call = (action: string, body: Record<string, string> = {}, q = "") =>
  handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: "CAkey9", ...body }, callSid: "CAkey9", from: "+18455550177" });
const said = (xml: string) => [...xml.matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => m[1].replace(/&apos;/g, "'").replace(/&amp;/g, "&"));
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace(/^.*\/api\/voice\//, "").replace(/&amp;/g, "&");
const gatherAction = (xml: string) => xml.match(/<Gather [^>]*action="([^"]+)"/)?.[1].replace(/^.*\/api\/voice\//, "").replace(/&amp;/g, "&");

/** Follow redirects until the caller hears a menu (a Gather); returns that screen. */
async function follow(action: string, body: Record<string, string> = {}, q = "") {
  let xml = await call(action, body, q);
  for (let i = 0; i < 8 && !xml.includes("<Gather"); i++) {
    const to = redirect(xml);
    if (!to) break;
    const [a, qs = ""] = to.split("?");
    xml = await call(a, {}, qs);
  }
  return xml;
}
/** Press a key on the screen just heard (its Gather action, with the same query). */
async function press(screen: string, digit: string) {
  const [a, qs = ""] = gatherAction(screen)!.split("?");
  return follow(a, { Digits: digit }, qs);
}
/** The first answer to a key (before any redirect is followed). */
async function pressOnce(screen: string, digit: string) {
  const [a, qs = ""] = gatherAction(screen)!.split("?");
  return call(a, { Digits: digit }, qs);
}

const T = (n: number) => PROMPTS[KEYS[n - 1]].text;
const KEYS = [
  "lset_nomaze_second_6", "lset_nomaze_second_4", "lset_nomaze_third_6", "lset_nomaze_third_4",
  "lset_nomaze_second_no6", "lset_nomaze_second_no4", "lset_nomaze_third_no6", "lset_nomaze_third_no4",
  "lset_maze_second_6", "lset_maze_second_4", "lset_maze_third_6", "lset_maze_third_4",
  "lset_maze_second_no6", "lset_maze_second_no4", "lset_maze_third_no6", "lset_maze_third_no4",
] as const;
const KEEP = "To keep shopping, for same day, press 1. For another day, press 2.";

const ids = { maze6: 0, maze4: 0, guns6: 0, guns4: 0, pack6: 0, pack4: 0 };
let day = 0;
/** A fresh weekday for each case (Mondays to Wednesdays in summer 2027, no holidays). */
const nextDate = () => {
  const d = new Date(Date.UTC(2027, 6, 12) + day++ * 7 * 86400000);
  return d.toISOString().slice(0, 10);
};
/** Another customer's booking that takes n of an item that day. */
async function block(date: string, productId: number, n: number) {
  for (let i = 0; i < n; i++) {
    const r = await reserveItem({ orderId: null, productId, qty: 1, eventDate: date, channel: "PHONE", holdExpiresAt: new Date(Date.now() + 3600_000), callSid: `CAother${date}${productId}${i}` });
    expect(r.ok).toBe(true);
  }
}
const lines = async () => db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, h.session.orderId!)).orderBy(schema.orderItems.id);
const order = async () => (await db.select().from(schema.orders).where(eq(schema.orders.id, h.session.orderId!)))[0];

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  const [laser] = await db.insert(schema.categories).values({ name: "Laser Tag and Inflatable Mazes", ivrDigit: 2, sortOrder: 2, active: true }).returning();
  const made = await db
    .insert(schema.products)
    .values([
      { categoryId: laser.id, name: "Inflatable Maze with 6 Laser Guns", priceCents: 20000, quantity: 1, active: true, stockGroup: "maze", sizeOrder: 1 },
      { categoryId: laser.id, name: "Inflatable Maze with 4 Laser Guns", priceCents: 17500, quantity: 1, active: true, stockGroup: "maze", sizeOrder: 2 },
      { categoryId: laser.id, name: "6 Laser Guns", priceCents: 11000, quantity: 3, active: true, sizeOrder: 3 },
      { categoryId: laser.id, name: "4 Laser Guns", priceCents: 7500, quantity: 3, active: true, sizeOrder: 4 },
    ])
    .returning();
  [ids.maze6, ids.maze4, ids.guns6, ids.guns4] = made.map((x) => x.id);
  const [addons] = await db.select().from(schema.categories).where(eq(schema.categories.name, "Laser tag add-ons"));
  const packs = await db
    .insert(schema.products)
    .values([
      { categoryId: addons.id, name: "Additional 6-Pack Laser Guns", priceCents: 7500, quantity: 3, sizeOrder: 1, active: true },
      { categoryId: addons.id, name: "Additional 4-Pack Laser Guns", priceCents: 5000, quantity: 3, sizeOrder: 2, active: true },
    ])
    .returning();
  [ids.pack6, ids.pack4] = packs.map((x) => x.id);
  await saveSetting("laserThirdSetHalfOn", true);
});
beforeEach(() => {
  h.session.orderId = null;
  h.session.data = {};
});

describe("the 16 Admin slots", () => {
  it("exact approved texts, editable, Google voice until uploaded; the old lines retired", () => {
    expect(KEYS.map((k) => PROMPTS[k].text)).toEqual([
      "To add a second six-pack of laser guns for $110, press 9.",
      "To add a second four-pack of laser guns for $75, press 9.",
      "To add a third six-pack of laser guns for half price, only $55, press 9.",
      "To add a third four-pack of laser guns for half price, only $37.50, press 9.",
      "We have no more six-packs to add for that day. To add a four-pack of laser guns for $75, press 9.",
      "We have no more four-packs to add for that day. To add a six-pack of laser guns for $110, press 9.",
      "We have no more six-packs to add for that day. To add a four-pack of laser guns for half price, only $37.50, press 9.",
      "We have no more four-packs to add for that day. To add a six-pack of laser guns for half price, only $55, press 9.",
      "To add a second six-pack of laser guns for $75, press 9.",
      "To add a second four-pack of laser guns for $50, press 9.",
      "To add a third six-pack of laser guns for half price, only $37.50, press 9.",
      "To add a third four-pack of laser guns for half price, only $25, press 9.",
      "We have no more six-packs to add for that day. To add a four-pack of laser guns for $50, press 9.",
      "We have no more four-packs to add for that day. To add a six-pack of laser guns for $75, press 9.",
      "We have no more six-packs to add for that day. To add a four-pack of laser guns for half price, only $25, press 9.",
      "We have no more four-packs to add for that day. To add a six-pack of laser guns for half price, only $37.50, press 9.",
    ]);
    for (const k of KEYS) {
      expect(promptArea(PROMPTS[k].group)).toBe("Key 1: Bookings");
      expect("pending" in PROMPTS[k]).toBe(false);
      expect("vars" in PROMPTS[k]).toBe(false);
    }
    for (const k of ["laser_second_set", "second_laser", "laser_third_set", "laser_packs"]) expect(RETIRED_PROMPTS.has(k)).toBe(true);
  });
});

/** Add the first set, then press 9 while offered; returns each box 25 offer line heard (null = no offer). */
async function run(first: number, date: string, presses: number) {
  const heard: (string | null)[] = [];
  let screen = await follow("add", {}, `p=${first}&d=${date}&q=1`);
  for (let i = 0; ; i++) {
    const s = said(screen);
    const keepAt = s.indexOf(KEEP);
    expect(keepAt).toBeGreaterThan(0); // the added line, then (the offer), then the keep-shopping lines
    heard.push(keepAt === 2 ? s[1] : null);
    if (i >= presses || keepAt !== 2) break;
    screen = await press(screen, "9");
  }
  return { heard, screen };
}
const dollars = (c: number) => c / 100;

describe("normal offers: the same size, second at the catalog price, third at half price, then the cap", () => {
  it.each([
    ["six-pack only", "guns6", "guns6", [1, 3], [110, 110, 55]],
    ["four-pack only", "guns4", "guns4", [2, 4], [75, 75, 37.5]],
    ["maze with 6 guns", "maze6", "pack6", [9, 11], [200, 75, 37.5]],
    ["maze with 4 guns", "maze4", "pack4", [10, 12], [175, 50, 25]],
  ] as const)("%s", async (_n, first, extra, offers, charged) => {
    const date = nextDate();
    const { heard, screen } = await run(ids[first], date, 2);
    expect(heard).toEqual([T(offers[0]), T(offers[1]), null]); // second, third, then no more (3 sets)
    const ls = await lines();
    expect(ls.map((l) => l.productId)).toEqual([ids[first], ids[extra], ids[extra]]);
    expect(ls.map((l) => dollars(l.unitPriceCents))).toEqual(charged);
    expect(dollars((await order()).subtotalCents)).toBe(charged.reduce((a, b) => a + b, 0)); // the cart total
    const { spokenMoney } = await import("@/lib/money");
    expect(said(await follow("cart"))).toContain(`Your rental total is ${spokenMoney(Math.round(charged.reduce((a, b) => a + b, 0) * 100))}, plus delivery and sales tax.`); // the cart says it
    // the cap: 9 now adds nothing (not valid, box 25 again)
    const again = await pressOnce(screen, "9");
    expect(said(again)).toEqual([PROMPTS.not_valid.text]);
    expect(redirect(again)).toMatch(/^added-menu/);
    expect(await lines()).toHaveLength(3);
  });
  it("the offer comes right after the added line and before the same-day and another-day lines; 1, 2, 0 and star as before", async () => {
    const date = nextDate();
    const screen = await follow("add", {}, `p=${ids.guns6}&d=${date}&q=1`);
    expect(said(screen)).toEqual(["Successfully added to your cart: 6 Laser Guns.", T(1), KEEP, PROMPTS.cart_key.text, PROMPTS.book_back.text]);
    const go = async (d: string) => redirect(await call(gatherAction(screen)!.split("?")[0], { Digits: d }, gatherAction(screen)!.split("?")[1]));
    expect(await go("1")).toBe("cats");
    expect(await go("2")).toBe("date?a=1");
    expect(await go("0")).toBe("cart");
    expect(await go("*")).toBe("book");
    expect(await lines()).toHaveLength(1); // none of them adds a set
  });
  it("no key: box 25 plays again with the same offer", async () => {
    const date = nextDate();
    const screen = await follow("add", {}, `p=${ids.guns4}&d=${date}&q=1`);
    const [a, qs] = gatherAction(screen)!.split("?");
    const again = await follow(a, {}, qs);
    expect(said(again)).toContain(T(2));
  });
});

describe("sold out: the other size with the sold-out line; both gone: no offer", () => {
  it.each([
    // [case, first, block before the second, sold-out line, added, charged]
    ["5. no maze, second: six-packs gone", "guns6", ["guns6", 2], 5, "guns4", [110, 75]],
    ["6. no maze, second: four-packs gone", "guns4", ["guns4", 2], 6, "guns6", [75, 110]],
    ["13. maze, second: six-packs gone", "maze6", ["guns6", 2], 13, "pack4", [200, 50]],
    ["14. maze, second: four-packs gone", "maze4", ["guns4", 2], 14, "pack6", [175, 75]],
  ] as const)("%s", async (_n, first, [what, n], line, added, charged) => {
    const date = nextDate();
    await block(date, ids[what], n);
    const { heard } = await run(ids[first], date, 1);
    expect(heard[0]).toBe(T(line));
    const ls = await lines();
    expect(ls.map((l) => l.productId)).toEqual([ids[first], ids[added]]);
    expect(ls.map((l) => dollars(l.unitPriceCents))).toEqual(charged);
    expect(dollars((await order()).subtotalCents)).toBe(charged[0] + charged[1]);
  });
  it.each([
    // the third set: the caller's size just ran out
    ["7. no maze, third: six-packs gone", "guns6", "guns6", 7, "guns4", [110, 110, 37.5]],
    ["8. no maze, third: four-packs gone", "guns4", "guns4", 8, "guns6", [75, 75, 55]],
    ["15. maze, third: six-packs gone", "maze6", "guns6", 15, "pack4", [200, 75, 25]],
    ["16. maze, third: four-packs gone", "maze4", "guns4", 16, "pack6", [175, 50, 37.5]],
  ] as const)("%s", async (_n, first, gone, line, added, charged) => {
    const date = nextDate();
    let screen = await follow("add", {}, `p=${ids[first]}&d=${date}&q=1`);
    screen = await press(screen, "9"); // the second set, the same size
    await block(date, ids[gone], 1); // the last one of that size goes to someone else
    const [a, qs] = gatherAction(screen)!.split("?");
    screen = await follow(a, {}, qs); // box 25 again
    expect(said(screen)[1]).toBe(T(line));
    screen = await press(screen, "9");
    const ls = await lines();
    expect(ls.map((l) => l.productId).at(-1)).toBe(ids[added]);
    expect(ls.map((l) => dollars(l.unitPriceCents))).toEqual(charged); // the third set added is the half-price one
    expect(dollars((await order()).subtotalCents)).toBe(charged.reduce((x, y) => x + y, 0));
    expect(said(screen)[1]).toBe(KEEP); // the cap: no fourth offer
  });
  it.each([
    ["no maze", "guns6"],
    ["maze", "maze6"],
  ] as const)("both sizes gone (%s): no offer, 9 adds nothing", async (_n, first) => {
    const date = nextDate();
    await block(date, ids.guns6, first === "maze6" ? 2 : 2);
    await block(date, ids.guns4, 3);
    const { heard, screen } = await run(ids[first], date, 1);
    expect(heard).toEqual([null]);
    expect(said(await pressOnce(screen, "9"))).toEqual([PROMPTS.not_valid.text]);
    expect(await lines()).toHaveLength(1);
  });
  it("the third offer with the other size gone too: no offer after the second set", async () => {
    const date = nextDate();
    let screen = await follow("add", {}, `p=${ids.guns6}&d=${date}&q=1`);
    screen = await press(screen, "9");
    await block(date, ids.guns6, 1);
    await block(date, ids.guns4, 3);
    const [a, qs] = gatherAction(screen)!.split("?");
    expect(said(await follow(a, {}, qs))[1]).toBe(KEEP);
  });
});

describe("prices", () => {
  it("the half price is off: no third-set line, the second still offered", async () => {
    await saveSetting("laserThirdSetHalfOn", false);
    try {
      const { heard } = await run(ids.guns6, nextDate(), 1);
      expect(heard).toEqual([T(1), null]);
      expect((await lines()).map((l) => l.unitPriceCents)).toEqual([11000, 11000]);
    } finally {
      await saveSetting("laserThirdSetHalfOn", true);
    }
  });
  it("a catalog price that no longer matches the line: the offer is not played (never a wrong price)", async () => {
    await db.update(schema.products).set({ priceCents: 12000 }).where(eq(schema.products.id, ids.guns6));
    try {
      const { heard } = await run(ids.guns6, nextDate(), 0);
      expect(heard).toEqual([null]);
    } finally {
      await db.update(schema.products).set({ priceCents: 11000 }).where(eq(schema.products.id, ids.guns6));
    }
  });
  it("the half price never stacks with a customer discount: the bigger saving applies", async () => {
    const { quoteBooking } = await import("@/lib/order-pricing");
    const phone = "+18455550188";
    const q0 = await quoteBooking({ items: [{ productId: ids.guns6, qty: 3 }], eventDate: "2027-09-13", thuSun: false, phone, address: null });
    expect(q0.itemsCents).toBe(27500); // $110 + $110 + $55
    await db.insert(schema.customerDiscounts).values({ phone, kind: "percent", percent: "10", note: "" });
    const q1 = await quoteBooking({ items: [{ productId: ids.guns6, qty: 3 }], eventDate: "2027-09-13", thuSun: false, phone, address: null });
    expect(q1.subtotalCents).toBe(27500); // 10% of $330 = $33 is less than the $55 half price: the half price only
    expect(q1.offerCents).toBe(0);
    await db.update(schema.customerDiscounts).set({ percent: "25" }).where(eq(schema.customerDiscounts.phone, phone));
    const q2 = await quoteBooking({ items: [{ productId: ids.guns6, qty: 3 }], eventDate: "2027-09-13", thuSun: false, phone, address: null });
    expect(q2.subtotalCents).toBe(24750); // 25% of the full $330 = $82.50 off; no half price on top
    expect(q2.offerNote).toBe("Customer discount: 25% off");
  });
});

describe("every laser menu works as spoken", () => {
  it("the laser tag list: each key adds the item its line names, and the price said in box 25 offers is what is charged", async () => {
    const date = nextDate();
    const [cat] = await db.select().from(schema.categories).where(eq(schema.categories.name, "Laser Tag and Inflatable Mazes"));
    h.session.data = { day: date };
    const list = await follow("category", {}, `c=${cat.id}`);
    const s = said(list);
    for (const n of [1, 2, 3, 4]) expect(s).toContain(PROMPTS[`laser_item_${n}` as "laser_item_1"].text);
    const byKey: Record<string, number> = { "1": ids.maze6, "2": ids.maze4, "3": ids.guns6, "4": ids.guns4 };
    for (const [k, id] of Object.entries(byKey)) {
      h.session.orderId = null;
      h.session.data = { day: nextDate() };
      const [a, qs] = gatherAction(list)!.split("?");
      const to = redirect(await call(a, { Digits: k }, qs))!;
      const screen = await follow(to.split("?")[0], {}, to.split("?")[1]);
      expect((await lines()).map((l) => l.productId)).toEqual([id]); // the key added the item its line names
      expect(said(screen)[1]).toMatch(/press 9\.$/); // and box 25 offers the next set
    }
  });
});
