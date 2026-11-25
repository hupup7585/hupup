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

/* Laser tag extra gun sets (Abraham, Nov 25, 2026, 14:06 and 14:41): after the 1st extra set "To add a second one,
 * press 1.", after the 2nd "To add a third gun set for half price, only {price}, press 1."; every 3rd set is half price. */
let maze6 = 0;
const ids = { pack6: 0, pack4: 0 };
const SECOND = "To add a second one, press 1.";
const STAY = "Otherwise, stay on the line.";

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  const [laser] = await db.insert(schema.categories).values({ name: "Laser Tag and Inflatable Mazes", ivrDigit: 2, sortOrder: 2, active: true }).returning();
  const [m] = await db
    .insert(schema.products)
    .values([
      { categoryId: laser.id, name: "Inflatable Maze with 6 Laser Guns", priceCents: 20000, quantity: 1, active: true, stockGroup: "maze" },
      { categoryId: laser.id, name: "6 Laser Guns", priceCents: 11000, quantity: 3, active: true },
      { categoryId: laser.id, name: "4 Laser Guns", priceCents: 7500, quantity: 3, active: true },
    ])
    .returning();
  maze6 = m.id;
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
const order = async (id: number) => (await db.select().from(schema.orders).where(eq(schema.orders.id, id)))[0];
const items = async (id: number) => db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, id)).orderBy(schema.orderItems.id);

describe("the slots", () => {
  it("the third-set line in two pieces around the price; the second line", async () => {
    const { PROMPTS } = await import("@/lib/ivr/prompts");
    expect(PROMPTS.laser_third_set.text).toBe("To add a third gun set for half price, only {price}, press 1.");
    expect(PROMPTS.laser_second_set.text).toBe(SECOND);
    const { allSlots } = await import("@/lib/recording-slots");
    const slot = new Map(allSlots().map((s) => [s.key, s.text]));
    expect(slot.get("laser_third_set#1")).toBe("To add a third gun set for half price, only");
    expect(slot.get("laser_third_set#2")).toBe("press 1.");
  });
});

describe("maze + three six-gun sets", () => {
  it("1st set: the second-one line; 2nd set: the third set at $37.50; the 3rd set is charged half", async () => {
    const day = "2027-04-05";
    h.session.orderId = null;
    h.session.data = {};
    expect(redirect(await call("add", {}, `p=${maze6}&d=${day}&q=1`))).toBe(`packs?d=${day}`);
    expect(redirect(await call("packs-choice", { Digits: "1" }, `d=${day}`))).toBe(`packs?d=${day}`);
    const two = await call("packs", {}, `d=${day}`);
    expect(said(two)).toEqual([SECOND, STAY, "To go back, press star."]);
    expect(two).toMatch(/timeout="5"/);
    expect(redirect(await call("packs-choice", { Digits: "1" }, `d=${day}`))).toBe(`packs?d=${day}`);
    const three = said(await call("packs", {}, `d=${day}`));
    expect(three).toEqual(["To add a third gun set for half price, only 37 dollars and 50 cents, press 1.", STAY, "To go back, press star."]);
    const added = await call("packs-choice", { Digits: "1" }, `d=${day}`);
    expect(said(added)[0]).toMatch(/^Successfully added to your cart: /);
    const lines = await items(h.session.orderId!);
    expect(lines.filter((l) => l.productId === ids.pack6).map((l) => l.unitPriceCents)).toEqual([7500, 7500, 3750]);
    expect((await order(h.session.orderId!)).subtotalCents).toBe(20000 + 7500 + 7500 + 3750);
    // after the third: no more offers
    expect(redirect(await call("packs", {}, `d=${day}`))).toBe("added-menu?n=1");
  });
  it("no key at the third offer: nothing added, on to the keep-shopping lines; wrong key: not valid, the same line; star: back", async () => {
    const day = "2027-04-06";
    h.session.orderId = null;
    h.session.data = {};
    await call("add", {}, `p=${maze6}&d=${day}&q=1`);
    await call("packs-choice", { Digits: "1" }, `d=${day}`);
    await call("packs-choice", { Digits: "1" }, `d=${day}`);
    const offer = await call("packs", {}, `d=${day}`);
    expect(redirect(offer)).toBe("added-menu?n=1"); // no key for 5 seconds
    expect((await items(h.session.orderId!)).filter((l) => l.productId === ids.pack6)).toHaveLength(2);
    const bad = await call("packs-choice", { Digits: "5" }, `d=${day}`);
    expect(said(bad)).toEqual(["Sorry, that is not a valid selection."]);
    expect(redirect(bad)).toBe(`packs?d=${day}`);
    expect(redirect(await call("packs-choice", { Digits: "*" }, `d=${day}`))).toBe("added-menu?n=1");
  });
});

describe("no maze: four-gun sets at the regular price", () => {
  it("the third four-gun set is charged $37.50 (half of the $75 regular price), from the catalog", async () => {
    // A phone booking drops extra sets when the maze is removed (dropOrphanPacks); the booking screen keeps them at the
    // regular price. Same price rule for both.
    const { laserAddonPrices } = await import("@/lib/orders");
    const row = (key: number) => ({ key, name: "Additional 4-Pack Laser Guns", cat: "Laser tag add-ons", priceCents: 5000 });
    const prices = await laserAddonPrices(db, [row(1), row(2), row(3)]);
    expect([prices.get(1), prices.get(2), prices.get(3)]).toEqual([7500, 7500, 3750]);
    // with a maze: the add-on price, the third half of it ($25 for the four-gun set)
    const withMaze = await laserAddonPrices(db, [{ key: 0, name: "Inflatable Maze with 6 Laser Guns", cat: "Laser Tag and Inflatable Mazes", priceCents: 20000 }, row(1), row(2), row(3)]);
    expect([withMaze.get(1), withMaze.get(2), withMaze.get(3)]).toEqual([5000, 5000, 2500]);
  });
});
