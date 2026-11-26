import { beforeAll, describe, expect, it, vi } from "vitest";

/* Abraham, Nov 25, 2026, 4:03 PM: one laser switch, "Laser tag: every third set half price" (default ON). Full sets
 * (maze + guns) and extra gun sets are counted apart; every 3rd of each is half price; nothing is discounted twice.
 * OFF: no laser third-set discount anywhere and no "third gun set for half price" line. The old switch is gone. */
const h = vi.hoisted(() => ({
  session: { callSid: "CAlsw", fromNumber: "+18455550177", orderId: null as number | null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing", startedAt: new Date() },
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

import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { laserAddonPrices, refreshOrderTotals } from "@/lib/orders";
import { SETTING_DEFAULTS, saveSetting } from "@/lib/settings";
import { handleVoice } from "@/lib/ivr/flow";

const CAT = "Laser Tag and Inflatable Mazes";
const ADD = "Laser tag add-ons";
const maze = (key: number) => ({ key, name: "Inflatable Maze with 6 Laser Guns", cat: CAT, priceCents: 20000 });
const pack6 = (key: number) => ({ key, name: "Additional 6-Pack Laser Guns", cat: ADD, priceCents: 7500 });
const guns6 = (key: number) => ({ key, name: "6 Laser Guns", cat: CAT, priceCents: 11000 });
const prices = (m: Map<number, number>, keys: number[]) => keys.map((k) => m.get(k));

const call = (action: string, body: Record<string, string> = {}, q = "") =>
  handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: "CAlsw", ...body }, callSid: "CAlsw", from: "+18455550177" });
const said = (xml: string) => [...xml.matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => m[1].replace(/&apos;/g, "'"));
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace(/^.*\/api\/voice\//, "").replace(/&amp;/g, "&");

let ids = { maze: 0, maze4: 0, guns6: 0, pack6: 0 };
beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  const [laser] = await db.insert(schema.categories).values({ name: CAT, ivrDigit: 2, sortOrder: 2, active: true }).returning();
  const made = await db
    .insert(schema.products)
    .values([
      { categoryId: laser.id, name: "Inflatable Maze with 6 Laser Guns", priceCents: 20000, quantity: 1, active: true, stockGroup: "maze" },
      { categoryId: laser.id, name: "Inflatable Maze with 4 Laser Guns", priceCents: 17500, quantity: 1, active: true, stockGroup: "maze" },
      { categoryId: laser.id, name: "6 Laser Guns", priceCents: 11000, quantity: 3, active: true },
    ])
    .returning();
  const [addons] = await db.select().from(schema.categories).where(eq(schema.categories.name, ADD));
  const [p6] = await db.insert(schema.products).values([{ categoryId: addons.id, name: "Additional 6-Pack Laser Guns", priceCents: 7500, quantity: 10, sizeOrder: 1, active: true }]).returning();
  ids = { maze: made[0].id, maze4: made[1].id, guns6: made[2].id, pack6: p6.id };
});

describe("the switch", () => {
  it("one new switch, default ON; the old 'third pack 50% off' switch is gone everywhere", () => {
    expect((SETTING_DEFAULTS as Record<string, unknown>).laserThirdSetHalfOn).toBe(true);
    expect("offerLaserThirdPackOn" in SETTING_DEFAULTS).toBe(false);
    const page = readFileSync("src/app/admin/(app)/offers/page.tsx", "utf8");
    expect(page).toContain("Laser tag: every third set half price");
    expect(page).toContain('name="laserThirdSetHalfOn"');
    for (const f of ["src/app/admin/(app)/offers/page.tsx", "src/app/admin/(app)/offers/actions.ts", "src/lib/offers.ts", "src/lib/settings.ts", "src/app/admin/(app)/pos/PosForm.tsx", "src/app/pay/[orderId]/page.tsx"]) {
      expect(readFileSync(f, "utf8")).not.toMatch(/offerLaserThirdPackOn|third pack 50% off|laserThirdPackDiscount/i);
    }
  });
});

describe("switch ON (prices before tax)", () => {
  it("3 full sets with a maze ($200 each): the 3rd is $100", async () => {
    expect(prices(await laserAddonPrices(db, [maze(1), maze(2), maze(3)], true), [1, 2, 3])).toEqual([20000, 20000, 10000]);
  });
  it("6 full sets: the 3rd and the 6th are half; the 4th and 5th full price", async () => {
    const m = await laserAddonPrices(db, [1, 2, 3, 4, 5, 6].map(maze), true);
    expect(prices(m, [1, 2, 3, 4, 5, 6])).toEqual([20000, 20000, 10000, 20000, 20000, 10000]);
  });
  it("maze + extra six-gun sets: the maze's guns are the first set (Nov 26, 2026), so the 2nd extra (the 3rd set) is $37.50", async () => {
    expect(prices(await laserAddonPrices(db, [maze(1), pack6(2), pack6(3), pack6(4)], true), [1, 2, 3, 4])).toEqual([20000, 7500, 3750, 7500]);
  });
  it("no maze, 3 six-gun sets: $110 + $110 + $55", async () => {
    expect(prices(await laserAddonPrices(db, [guns6(1), guns6(2), guns6(3)], true), [1, 2, 3])).toEqual([11000, 11000, 5500]);
  });
  it("full sets and extra sets are counted apart: 3 full + 3 extra = one half full set and one half extra set", async () => {
    const m = await laserAddonPrices(db, [maze(1), pack6(2), maze(3), pack6(4), maze(5), pack6(6)], true);
    expect(prices(m, [1, 2, 3, 4, 5, 6])).toEqual([20000, 7500, 20000, 7500, 10000, 3750]);
  });
});

describe("never a double discount (a saved order)", () => {
  it("3 full sets: the 3rd line is $100, no extra offer on top, subtotal $500", async () => {
    await saveSetting("laserThirdSetHalfOn", true);
    const [o] = await db.insert(schema.orders).values({ status: "HOLD", channel: "PHONE", eventDate: "2027-06-07", pickupDate: "2027-06-08" }).returning();
    for (let i = 0; i < 3; i++) await db.insert(schema.orderItems).values({ orderId: o.id, productId: ids.maze, qty: 1, unitPriceCents: 20000 });
    await refreshOrderTotals(o.id);
    const lines = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, o.id)).orderBy(schema.orderItems.id);
    expect(lines.map((l) => l.unitPriceCents)).toEqual([20000, 20000, 10000]);
    const [after] = await db.select().from(schema.orders).where(eq(schema.orders.id, o.id));
    expect(after.offerDiscountCents).toBe(0);
    expect(after.subtotalCents).toBe(50000);
    // refreshed again: still halved once, never $50
    await refreshOrderTotals(o.id);
    const again = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, o.id)).orderBy(schema.orderItems.id);
    expect(again.map((l) => l.unitPriceCents)).toEqual([20000, 20000, 10000]);
  });
  it("the booking screen: 3 of the same full set in one line is priced per set too ($500)", async () => {
    const { quoteBooking } = await import("@/lib/order-pricing");
    const q = await quoteBooking({ items: [{ productId: ids.maze, qty: 3 }], eventDate: "2027-06-08", thuSun: false, phone: null, address: null });
    expect(q.itemsCents).toBe(50000);
    expect(q.offerCents).toBe(0);
  });
});

describe("switch OFF", () => {
  it("all full price: full sets, extra sets with a maze, guns-only sets", async () => {
    expect(prices(await laserAddonPrices(db, [1, 2, 3, 4, 5, 6].map(maze), false), [1, 2, 3, 4, 5, 6])).toEqual(Array(6).fill(20000));
    expect(prices(await laserAddonPrices(db, [maze(1), pack6(2), pack6(3), pack6(4)], false), [1, 2, 3, 4])).toEqual([20000, 7500, 7500, 7500]);
    expect(prices(await laserAddonPrices(db, [guns6(1), guns6(2), guns6(3)], false), [1, 2, 3])).toEqual([11000, 11000, 11000]);
  });
  it("the switch is read from Admin Settings when not passed", async () => {
    await saveSetting("laserThirdSetHalfOn", false);
    expect(prices(await laserAddonPrices(db, [maze(1), maze(2), maze(3)]), [1, 2, 3])).toEqual([20000, 20000, 20000]);
    await saveSetting("laserThirdSetHalfOn", true);
    expect(prices(await laserAddonPrices(db, [maze(1), maze(2), maze(3)]), [1, 2, 3])).toEqual([20000, 20000, 10000]);
  });
  it("the phone does not play the 'third gun set for half price' line (extra sets after a maze, and guns-only sets)", async () => {
    await saveSetting("laserThirdSetHalfOn", false);
    try {
      const day = "2027-06-14";
      h.session.orderId = null;
      h.session.data = {};
      await call("add", {}, `p=${ids.maze}&d=${day}&q=1`);
      const to = redirect(await call("after-add", { Digits: "9" }, `z=${day}:6`))!; // the second set
      expect(to).toBe(`add?p=${ids.pack6}&d=${day}&q=1`);
      expect(redirect(await call("add", {}, to.split("?")[1]))).toBe(`added-menu?z=${day}%3A6`);
      const after2 = await call("added-menu", {}, `z=${day}:6`);
      expect(said(after2).join(" ")).not.toMatch(/half price|press 9/i);
      const lines = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, h.session.orderId!)).orderBy(schema.orderItems.id);
      expect(lines.map((l) => l.unitPriceCents)).toEqual([20000, 7500]);
      expect(redirect(await call("after-add", { Digits: "9" }, `z=${day}:6`))).toBe(`added-menu?z=${day}%3A6`); // 9 adds nothing: not valid
      expect((await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, h.session.orderId!))).length).toBe(2);

      const day2 = "2027-06-15";
      h.session.orderId = null;
      h.session.data = {};
      await call("add", {}, `p=${ids.guns6}&d=${day2}&q=1`);
      await call("add", {}, `p=${ids.guns6}&d=${day2}&q=1`);
      expect(redirect(await call("added-second", {}, `p=${ids.guns6}&d=${day2}`))).toBe(`added-menu?z=${day2}%3A6`); // the old step: on to box 25
      const second = await call("added-menu", {}, `z=${day2}:6`);
      expect(said(second).join(" ")).not.toMatch(/half price|press 9/i);
    } finally {
      await saveSetting("laserThirdSetHalfOn", true);
    }
  });
});

// Nov 26, 2026 (key 9 offer): gun sets are halved in the order added (the third set), so the price spoken is the price
// charged; full sets (mazes) keep the 5:06 PM cheapest rule
describe("gun sets: the set added third is the half one; full sets: the cheapest", () => {
  const guns4 = (key: number) => ({ key, name: "4 Laser Guns", cat: CAT, priceCents: 7500 });
  const pack4 = (key: number) => ({ key, name: "Additional 4-Pack Laser Guns", cat: ADD, priceCents: 5000 });
  const sum = (m: Map<number, number>) => [...m.values()].reduce((a, b) => a + b, 0);
  it("1. no maze: two 6-gun sets + one 4-gun set = $110 + $110 + $37.50", async () => {
    expect(prices(await laserAddonPrices(db, [guns6(1), guns6(2), guns4(3)], true), [1, 2, 3])).toEqual([11000, 11000, 3750]);
  });
  it("2. added in order 4-gun, 6-gun, 6-gun: the third added (a 6-gun set) is half, $240", async () => {
    const m = await laserAddonPrices(db, [guns4(1), guns6(2), guns6(3)], true);
    expect(prices(m, [1, 2, 3])).toEqual([7500, 11000, 5500]);
    expect(sum(m)).toBe(24000);
  });
  it("3. maze + two +6-packs + one +4-pack: $200 + $75 + $75 + $25", async () => {
    expect(prices(await laserAddonPrices(db, [maze(1), pack6(2), pack4(3), pack6(4)], true), [1, 2, 3, 4])).toEqual([20000, 7500, 2500, 7500]);
  });
  it("4. maze + six extra sets: the 3rd and 6th sets are half", async () => {
    const m = await laserAddonPrices(db, [maze(1), pack6(2), pack4(3), pack6(4), pack6(5), pack4(6), pack6(7)], true);
    expect(prices(m, [2, 3, 4, 5, 6, 7])).toEqual([7500, 2500, 7500, 7500, 2500, 7500]);
  });
  it("5. three sets at the same price: one is half (the third added, as before)", async () => {
    expect(prices(await laserAddonPrices(db, [guns6(1), guns6(2), guns6(3)], true), [1, 2, 3])).toEqual([11000, 11000, 5500]);
  });
  it("6. a set removed: which sets are half is worked out again", async () => {
    const all = await laserAddonPrices(db, [guns6(1), guns4(2), guns6(3), guns6(4)], true);
    expect(prices(all, [1, 2, 3, 4])).toEqual([11000, 7500, 5500, 11000]);
    const without4 = await laserAddonPrices(db, [guns6(1), guns6(3), guns6(4)], true);
    expect(prices(without4, [1, 3, 4])).toEqual([11000, 11000, 5500]);
  });
  it("full sets: the cheapest maze set is the half one", async () => {
    const maze4 = (key: number) => ({ key, name: "Inflatable Maze with 4 Laser Guns", cat: CAT, priceCents: 17500 });
    expect(prices(await laserAddonPrices(db, [maze4(1), maze(2), maze(3)], true), [1, 2, 3])).toEqual([8750, 20000, 20000]);
  });
});
