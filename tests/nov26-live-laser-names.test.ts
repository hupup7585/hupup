import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Key 9 "add another laser set" (Abraham, Nov 26, 2026). Right after any laser set is added, box 25 offers one more,
 * before the same-day and another-day lines: the same size the caller just picked ("second" at the catalog price,
 * "third" at half price), else the other size with the sold-out line, else nothing; at most 3 sets. Every laser menu
 * on the phone works as spoken: each key does what its line says, the price said is the price charged, and the cart
 * total is what was said.
 */
const h = vi.hoisted(() => ({
  session: { callSid: "CAlive26", fromNumber: "+18455550178", orderId: null as number | null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing", startedAt: new Date() },
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
  handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: "CAlive26", ...body }, callSid: "CAlive26", from: "+18455550178" });
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


/* Abraham's test calls, Nov 26, 2026, 8:41 PM: the live laser items are named "Only 6 laser guns" / "Only 4 laser
 * guns". Each key adds exactly the item its line names, and the key 9 offer plays after a guns-only set. */
const ids = { maze6: 0, maze4: 0, guns6: 0, guns4: 0, laserCat: 0 };
beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  const [laser] = await db.insert(schema.categories).values({ name: "Laser Tag and Inflatable Mazes", ivrDigit: 2, sortOrder: 2, active: true }).returning();
  ids.laserCat = laser.id;
  const made = await db
    .insert(schema.products)
    .values([
      { categoryId: laser.id, name: "Inflatable maze with 6 laser guns", priceCents: 20000, quantity: 1, active: true, stockGroup: "maze", sizeOrder: 1 },
      { categoryId: laser.id, name: "Inflatable maze with 4 laser guns", priceCents: 17500, quantity: 1, active: true, stockGroup: "maze", sizeOrder: 2 },
      { categoryId: laser.id, name: "Only 6 laser guns", priceCents: 11000, quantity: 3, active: true, sizeOrder: 3 },
      { categoryId: laser.id, name: "Only 4 laser guns", priceCents: 7500, quantity: 3, active: true, sizeOrder: 4 },
    ])
    .returning();
  [ids.maze6, ids.maze4, ids.guns6, ids.guns4] = made.map((x) => x.id);
  const [addons] = await db.select().from(schema.categories).where(eq(schema.categories.name, "Laser tag add-ons"));
  await db.insert(schema.products).values([
    { categoryId: addons.id, name: "Additional 6-Pack Laser Guns", priceCents: 7500, quantity: 3, sizeOrder: 1, active: true },
    { categoryId: addons.id, name: "Additional 4-Pack Laser Guns", priceCents: 5000, quantity: 3, sizeOrder: 2, active: true },
  ]);
});
beforeEach(() => {
  h.session.orderId = null;
  h.session.data = { day: "2027-07-13" };
});
const lines = async () => db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, h.session.orderId!)).orderBy(schema.orderItems.id);

describe("laser tag list with the live item names", () => {
  it("the four recorded lines play for keys 1 to 4; no item is read by the computer voice as key 5 or 6", async () => {
    const xml = await follow("category", {}, `c=${ids.laserCat}`);
    const s = said(xml).join(" ");
    for (const k of ["laser_item_1", "laser_item_2", "laser_item_3", "laser_item_4"] as const) expect(s).toContain(PROMPTS[k].text);
    expect(s).not.toMatch(/press 5|press 6/);
  });
  for (const [key, name] of [["1", "Inflatable maze with 6 laser guns"], ["2", "Inflatable maze with 4 laser guns"], ["3", "Only 6 laser guns"], ["4", "Only 4 laser guns"]] as const) {
    it(`key ${key} adds exactly ${name}`, async () => {
      h.session.data = { day: `2027-07-${String(13 + Number(key) * 7 > 31 ? 13 : 13).padStart(2, "0")}` };
      h.session.data.day = ["2027-07-13", "2027-07-20", "2027-07-27", "2027-08-03"][Number(key) - 1];
      const list = await follow("category", {}, `c=${ids.laserCat}`);
      await press(list, key);
      const l = await lines();
      const [p] = await db.select().from(schema.products).where(eq(schema.products.id, l[0].productId));
      expect(p.name).toBe(name);
    });
  }
  it("after Only 6 laser guns, box 25 offers a second six-pack (key 9) and key 9 adds it", async () => {
    h.session.data = { day: "2027-08-10" };
    const list = await follow("category", {}, `c=${ids.laserCat}`);
    const added = await press(list, "3");
    expect(said(added).join(" ")).toContain(PROMPTS.lset_nomaze_second_6.text);
    await press(added, "9");
    expect((await lines()).map((x) => x.productId)).toEqual([ids.guns6, ids.guns6]);
  });
  it("after the maze with 6 guns, box 25 offers the extra six-pack", async () => {
    h.session.data = { day: "2027-08-17" };
    const list = await follow("category", {}, `c=${ids.laserCat}`);
    const added = await press(list, "1");
    expect(said(added).join(" ")).toContain(PROMPTS.lset_maze_second_6.text);
  });
});
