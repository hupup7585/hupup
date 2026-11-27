import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/*
 * 09:00 deep check (phone booking), P17, P18, P21: simulated calls through the real hotline steps (handleVoice), real
 * call sessions and orders in the in-memory database, the clock pinned to an ordinary open weekday.
 */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));
vi.mock("@/lib/notify", () => ({ sendSms: async () => ({ sent: true }), sendEmail: async () => ({ sent: true }), sendOrderText: async () => ({ texted: true }) }));
vi.mock("@/lib/twilio-client", () => ({ getTwilio: () => null }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { handleVoice } from "@/lib/ivr/flow";
import { ensureSession, getSession, updateSession } from "@/lib/ivr/session";

const at = (iso: string) => {
  vi.setSystemTime(new Date(iso));
  process.env.HUP_CALENDAR_NOW = iso;
};
const say = (xml: string) => [...xml.matchAll(/<Say[^>]*>([^<]*)<\/Say>/g)].map((m) => m[1]).join(" ");
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace(/^.*\/api\/voice\//, "").replace(/&amp;/g, "&");
const gatherTo = (xml: string) => xml.match(/<Gather[^>]*action="([^"]+)"/)?.[1].replace(/^.*\/api\/voice\//, "").replace(/&amp;/g, "&");

let castle = 0;
let bigCastle = 0;
let slide = 0;
let slides = 0;
let bounce = 0;
let n = 0;
beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  at("2027-01-13T17:00:00Z"); // Wednesday, January 13, 2027, noon: open
  const [b] = await db.insert(schema.categories).values({ name: "Bounce Houses", sortOrder: 1 }).returning();
  const [s] = await db.insert(schema.categories).values({ name: "Slides", sortOrder: 2 }).returning();
  bounce = b.id;
  slides = s.id;
  const [c1, c2, sl] = await db
    .insert(schema.products)
    .values([
      { categoryId: b.id, name: "Castle", priceCents: 20000, quantity: 20 },
      { categoryId: b.id, name: "Big Castle", priceCents: 30000, quantity: 20 },
      { categoryId: s.id, name: "Slide", priceCents: 15000, quantity: 20 },
    ])
    .returning();
  castle = c1.id;
  bigCastle = c2.id;
  slide = sl.id;
});
afterAll(() => {
  vi.useRealTimers();
  process.env.HUP_CALENDAR_NOW = "2026-11-17T17:00:00Z";
});

function caller() {
  const from = `+184555508${String(++n).padStart(2, "0")}`;
  const sid = `CAp${n}`;
  const call = (action: string, body: Record<string, string> = {}, q = "") => handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: sid, ...body }, callSid: sid, from });
  return { sid, from, call };
}
const ordersOf = async (sid: string) => db.select().from(schema.orders).where(eq(schema.orders.callSid, sid));
const itemsOf = async (orderId: number) => db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, orderId));

/** Box 18: the Castle for Monday Jan 18 with "the next day too" (key 2), then added. */
async function castleWithNextDay(c: ReturnType<typeof caller>) {
  await ensureSession(c.sid, c.from);
  const q = `p=${castle}&d=2027-01-18`;
  const ask = await c.call("date-ask", {}, q);
  expect(gatherTo(ask)).toBe(`box18-choice?${q}&t=1`);
  expect(redirect(await c.call("box18-choice", { Digits: "2" }, `${q}&t=1`))).toBe(`qty?${q}`);
  await c.call("add", {}, `${q}&q=1`);
  const [o] = await ordersOf(c.sid);
  expect(o.spanDays).toBe(1.5);
  return o;
}

describe("P17: a 'next day too' choice stays with its rental", () => {
  it("same day, press 1, then a Slide from the list: the Slide is its own plain booking (not 1.5x, not kept the extra day)", async () => {
    const c = caller();
    const spanned = await castleWithNextDay(c);
    expect(redirect(await c.call("category-choice", { Digits: "1" }, `c=${slides}`))).toBe(`qty?p=${slide}&d=2027-01-18`);
    expect((await getSession(c.sid))!.data.spanDays?.["2027-01-18"]).toBeUndefined();
    await c.call("add", {}, `p=${slide}&d=2027-01-18&q=1`);
    const all = await ordersOf(c.sid);
    expect(all).toHaveLength(2);
    const plain = all.find((o) => o.id !== spanned.id)!;
    expect(plain.spanDays).toBeNull();
    expect(plain.pickupDate).not.toBe(spanned.pickupDate);
    expect((await itemsOf(plain.id)).map((i) => i.productId)).toEqual([slide]);
    expect((await itemsOf(spanned.id)).map((i) => i.productId)).toEqual([castle]); // the Castle's own booking untouched
    expect((await db.select().from(schema.orders).where(eq(schema.orders.id, spanned.id)))[0].spanDays).toBe(1.5);
  });
  it("the same from a jumping balloon item screen (press 1 to add) and from a product screen (press 2)", async () => {
    const c = caller();
    await castleWithNextDay(c);
    expect(redirect(await c.call("balloon-choice", { Digits: "1" }, `p=${bigCastle}`))).toBe(`qty?p=${bigCastle}&d=2027-01-18`);
    expect((await getSession(c.sid))!.data.spanDays?.["2027-01-18"]).toBeUndefined();
    const c2 = caller();
    await castleWithNextDay(c2);
    expect(redirect(await c2.call("product-choice", { Digits: "2" }, `p=${slide}`))).toBe(`qty?p=${slide}&d=2027-01-18`);
    expect((await getSession(c2.sid))!.data.spanDays?.["2027-01-18"]).toBeUndefined();
  });
  it("the Castle's own add-on (a second one, key 1 on box 25) still goes on the next-day booking", async () => {
    const c = caller();
    const spanned = await castleWithNextDay(c);
    await c.call("add", {}, `p=${castle}&d=2027-01-18&q=1`); // what box 25 key 1 does: one more of the same item, same date
    const all = await ordersOf(c.sid);
    expect(all).toHaveLength(1);
    expect((await itemsOf(spanned.id)).reduce((t, i) => t + i.qty, 0)).toBe(2);
  });
  it("item taken, another size (1) or another date (1/2): a plain booking, no span from earlier", async () => {
    const c = caller();
    await ensureSession(c.sid, c.from);
    await updateSession(c.sid, { data: { spanDays: { "2027-01-18": { after: "2027-01-20", days: 1.5 }, "2027-01-19": { after: "2027-01-21", days: 1.5 } } } });
    expect(redirect(await c.call("taken-size-choice", { Digits: "2" }, `p=${castle}&d=2027-01-18&up=${bigCastle}`))).toBe(`qty?p=${bigCastle}&d=2027-01-18`);
    expect(redirect(await c.call("nearest-choice", { Digits: "2" }, `p=${castle}&d=2027-01-18&b=2027-01-17&a=2027-01-19`))).toBe(`qty?p=${castle}&d=2027-01-19`);
    expect((await getSession(c.sid))!.data.spanDays).toEqual({});
  });
  it("box 18 key 2 itself, and the closed-day offer, still set the span (unchanged)", async () => {
    const c = caller();
    await castleWithNextDay(c);
  });
});

describe("P18: Friday only is only Friday after an earlier closed-day span on that Friday", () => {
  const fri = "2027-12-24"; // a Friday in Chanukah: box 150 asks Friday only or with Mutze Shabbes
  for (const [key, label] of [["1", "Friday only"], ["2", "with Mutze Shabbes"]] as const) {
    it(`${label}: the earlier span is cleared`, async () => {
      const c = caller();
      at("2027-12-20T17:00:00Z");
      await ensureSession(c.sid, c.from);
      await updateSession(c.sid, { data: { spanDays: { [fri]: { after: "2027-12-26", days: 2 } } } });
      const ask = await c.call("date-ask", {}, `p=${castle}&d=${fri}`);
      expect(gatherTo(ask)).toBe(`date-confirm?p=${castle}&d=${fri}&f=1`);
      expect(redirect(await c.call("date-confirm", { Digits: key }, `p=${castle}&d=${fri}&f=1`))).toBe(`qty?p=${castle}&d=${fri}`);
      const s = await getSession(c.sid);
      expect(s!.data.spanDays?.[fri]).toBeUndefined();
      expect(s!.data.mutzeDays ?? []).toEqual(key === "2" ? [fri] : []);
      await c.call("add", {}, `p=${castle}&d=${fri}&q=1`);
      const [o] = await ordersOf(c.sid);
      expect(o.spanDays).toBeNull();
      at("2027-01-13T17:00:00Z");
    });
  }
});

describe("P21: the 'another day' and 'free that date' values are kept on every way back", () => {
  it("box 150 (Friday only or Mutze): a wrong key and star keep 'another day'", async () => {
    const c = caller();
    at("2027-12-20T17:00:00Z");
    await ensureSession(c.sid, c.from);
    const wrong = await c.call("date-confirm", { Digits: "7" }, `d=2027-12-24&f=1&a=1`);
    expect(say(wrong)).toContain("Sorry, that is not a valid selection.");
    expect(redirect(wrong)).toBe("date-ask?d=2027-12-24&a=1");
    expect(redirect(await c.call("date-confirm", { Digits: "*" }, `d=2027-12-24&f=1&a=1`))).toBe("date?a=1");
    expect(redirect(await c.call("date-confirm", { Digits: "3" }, `d=2027-12-24&f=1&a=1`))).toBe("date?a=1");
    expect(redirect(await c.call("date-confirm", {}, `d=2027-12-24&f=1&a=1`))).toBe("date-ask?d=2027-12-24&a=1");
    at("2027-01-13T17:00:00Z");
  });
  it("an item list filtered to what is free that date: a wrong key, the cart (0) and back keep the filter", async () => {
    const c = caller();
    await ensureSession(c.sid, c.from);
    const f = "2027-01-18";
    const wrong = await c.call("category-choice", { Digits: "7" }, `c=${slides}&f=${f}`);
    expect(say(wrong)).toContain("Sorry, that is not a valid selection.");
    expect(redirect(wrong)).toBe(`category?c=${slides}&f=${f}`);
    expect(redirect(await c.call("category-choice", { Digits: "0" }, `c=${slides}&f=${f}`))).toBe(`cart?c=${slides}&f=${f}`);
    expect(redirect(await c.call("cart", {}, `c=${slides}&f=${f}`))).toBe(`category?c=${slides}&f=${f}`); // empty cart: back to the same list
    expect(decodeURIComponent(redirect(await c.call("category-choice", {}, `c=${slides}&f=${f}`))!)).toContain(`f=${f}`); // no key (as before)
  });
  it("the jumping balloons list filtered to that date: the item screen keeps it, star goes back to the same filtered list", async () => {
    const c = caller();
    await ensureSession(c.sid, c.from);
    const f = "2027-01-18";
    const notOne = await c.call("balloon-pick", {}, `c=${bounce}&f=${f}&k=88`); // not a balloon number
    expect(say(notOne)).toContain("Sorry, that is not a valid selection.");
    expect(redirect(notOne)).toBe(`balloons?c=${bounce}&f=${f}`);
    const p = String(castle);
    expect(gatherTo(await c.call("balloon", {}, `p=${p}&f=${f}`))).toBe(`balloon-choice?p=${p}&f=${f}`);
    expect(redirect(await c.call("balloon-choice", { Digits: "*" }, `p=${p}&f=${f}`))).toBe(`balloons?c=${bounce}&f=${f}`);
    const wrong = await c.call("balloon-choice", { Digits: "7" }, `p=${p}&f=${f}`);
    expect(redirect(wrong)).toBe(`balloon?p=${p}&f=${f}`);
    expect(decodeURIComponent(await c.call("balloon-choice", {}, `p=${p}&f=${f}`))).toContain(`f=${f}`);
    expect(redirect(await c.call("balloon-choice", { Digits: "0" }, `p=${p}&f=${f}`))).toBe("cart"); // the cart key: unchanged
  });
});

describe("P16: a line's Saturday-night (Motzei Shabbes) hours ring once Shabbes is over", () => {
  async function saturdayNight(win: { from: string; to: string } | null) {
    const { defaultHours } = await import("@/lib/hours-schedule");
    const { getSettings, saveSetting } = await import("@/lib/settings");
    const h = defaultHours((await getSettings()) as never);
    h.lines.cs.schedule.days["6"] = win ? { closed: false, windows: [win] } : { closed: true, windows: [] };
    await saveSetting("hoursSchedules", JSON.stringify(h), null);
  }
  const ring = async (iso: string) => {
    at(iso);
    const c = caller();
    await ensureSession(c.sid, c.from);
    return c.call("ring", {}, "k=4");
  };
  afterAll(async () => {
    const { saveSetting } = await import("@/lib/settings");
    await saveSetting("hoursSchedules", "", null);
    at("2027-01-13T17:00:00Z");
  });
  it("customer service open Saturday 7-11 PM: 9 PM (after Shabbes) rings; Shabbes noon and 5:30 PM (before reopening) go to voicemail", async () => {
    await saturdayNight({ from: "19:00", to: "23:00" });
    const night = await ring("2027-01-17T02:00:00Z"); // Saturday 9 PM
    expect(night).toContain("<Dial");
    expect(say(night)).toContain("We are connecting you to our customer service.");
    expect(redirect(await ring("2027-01-16T17:00:00Z"))).toBe("voicemail?x=4"); // Shabbes noon
    expect(redirect(await ring("2027-01-16T22:30:00Z"))).toBe("voicemail?x=4"); // 5:30 PM, before the phone reopens
    expect(redirect(await ring("2027-01-17T04:30:00Z"))).toBe("voicemail?x=4"); // 11:30 PM, after the window
  });
  it("no Saturday-night hours (the default): 9 PM still goes to voicemail, as before", async () => {
    await saturdayNight(null);
    expect(redirect(await ring("2027-01-17T02:00:00Z"))).toBe("voicemail?x=4");
  });
  it("a weekday is unchanged: noon rings", async () => {
    await saturdayNight({ from: "19:00", to: "23:00" });
    expect(await ring("2027-01-13T17:00:00Z")).toContain("<Dial");
  });
});
