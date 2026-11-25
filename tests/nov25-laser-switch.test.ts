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
  it("maze + 3 extra six-gun sets: the 3rd extra is $37.50, the maze full price", async () => {
    expect(prices(await laserAddonPrices(db, [maze(1), pack6(2), pack6(3), pack6(4)], true), [1, 2, 3, 4])).toEqual([20000, 7500, 7500, 3750]);
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
      await call("packs-choice", { Digits: "1" }, `d=${day}`);
      await call("packs-choice", { Digits: "1" }, `d=${day}`);
      const after2 = await call("packs", {}, `d=${day}`);
      expect(said(after2).join(" ")).not.toMatch(/half price/i);
      expect(redirect(after2)).toBe("added-menu?n=1");
      const lines = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, h.session.orderId!)).orderBy(schema.orderItems.id);
      expect(lines.map((l) => l.unitPriceCents)).toEqual([20000, 7500, 7500]);

      const day2 = "2027-06-15";
      h.session.orderId = null;
      h.session.data = {};
      await call("add", {}, `p=${ids.guns6}&d=${day2}&q=1`);
      await call("add", {}, `p=${ids.guns6}&d=${day2}&q=1`);
      const second = await call("added-second", {}, `p=${ids.guns6}&d=${day2}`);
      expect(said(second).join(" ")).not.toMatch(/half price/i);
      expect(redirect(second)).toBe("added-menu");
    } finally {
      await saveSetting("laserThirdSetHalfOn", true);
    }
  });
});
