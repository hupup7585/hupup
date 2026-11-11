import { beforeAll, describe, expect, it, vi } from "vitest";

/* Key 1 (Abraham, Nov 9, 2026): category -> item -> date; if booked, next size up/down, or the same item on nearby dates. */
const h = vi.hoisted(() => ({
  session: { callSid: "CAbi", fromNumber: "+18455550170", orderId: null as number | null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing" },
}));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/session", () => ({
  ensureSession: async () => h.session,
  getSession: async () => h.session,
  updateSession: async (_sid: string, patch: Record<string, unknown> & { data?: Record<string, unknown> }) => Object.assign(h.session, { ...patch, data: { ...h.session.data, ...(patch.data ?? {}) } }),
}));
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));
vi.mock("@/lib/business-hours", async (orig) => ({ ...(await orig<typeof import("@/lib/business-hours")>()), officeOpenNow: () => true, lateHoursToday: () => null }));
vi.mock("@/lib/dates", async (orig) => ({ ...(await orig<typeof import("@/lib/dates")>()), todayISO: () => "2026-11-09" }));

import { db, schema } from "@/lib/db";
import { handleVoice, spokenDate } from "@/lib/ivr/flow";

const call = (action: string, body: Record<string, string> = {}, query = "") =>
  handleVoice({ action, query: new URLSearchParams(query), body: { CallSid: h.session.callSid, ...body }, callSid: h.session.callSid, from: "+18455550170" });
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace("https://hupup.example/api/voice/", "").replace(/&amp;/g, "&");
const said = (xml: string) => [...xml.matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => m[1].replace(/&apos;/g, "'").replace(/&amp;/g, "&"));
const action = (xml: string) => xml.match(/<Gather [^>]*action="([^"]+)"/)?.[1].replace("https://hupup.example/api/voice/", "").replace(/&amp;/g, "&");

let small = 0, medium = 0, large = 0, catId = 0;
const TUE = "2026-12-01"; // Tuesday
const book = async (productId: number, eventDate: string) => {
  const [o] = await db.insert(schema.orders).values({ status: "CONFIRMED", channel: "PHONE", eventDate, pickupDate: eventDate }).returning();
  await db.insert(schema.orderItems).values({ orderId: o.id, productId, qty: 1, unitPriceCents: 10000 });
};

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  const [cat] = await db.insert(schema.categories).values({ name: "Bounce Houses", spokenName: "bounce houses", ivrDigit: 1, sortOrder: 1, active: true }).returning();
  catId = cat.id;
  const rows = await db
    .insert(schema.products)
    .values([
      { categoryId: cat.id, name: "Small Castle", priceCents: 10000, quantity: 1, active: true, sortOrder: 1, sizeOrder: 1 },
      { categoryId: cat.id, name: "Medium Castle", priceCents: 15000, quantity: 1, active: true, sortOrder: 2, sizeOrder: 2 },
      { categoryId: cat.id, name: "Large Castle", priceCents: 20000, quantity: 1, active: true, sortOrder: 3, sizeOrder: 3 },
    ])
    .returning();
  [small, medium, large] = rows.map((r) => r.id);
});

describe("key 1: booking by item", () => {
  it("categories from Admin, then the items, then the date (keys only), confirmed with the day name and day number", async () => {
    expect(said(await call("book"))).toEqual([
      "Please note, orders can be placed only through our automated system. For information or questions, press 0 for customer service.",
      "For bounce houses, press 1.",
      "For schools, corporate events, and organizational bookings, press 9.",
      "To go back, press star.",
    ]); // Abraham, Nov 11, 2026: rental first, then the date
    const items = said(await call("category", {}, `c=${catId}`));
    expect(items.slice(0, 4)).toEqual(["Here are our bounce houses.", "For the Small Castle, press 1.", "For the Medium Castle, press 2.", "For the Large Castle, press 3."]);
    h.session.data = {};
    expect(redirect(await call("category-choice", { Digits: "2" }, `c=${catId}`))).toBe(`date?p=${medium}`);
    const date = await call("date", {}, `p=${medium}`);
    expect(said(date)).toEqual(["Please enter your event date: two digits for the month, then two digits for the day. For example, for March 5th, press 0, 3, 0, 5."]);
    expect(date).not.toContain('input="dtmf speech"');
    expect(redirect(await call("date-heard", { Digits: "1201" }, `p=${medium}`))).toBe(`date-ask?p=${medium}&d=${TUE}`);
    expect(said(await call("date-ask", {}, `p=${medium}&d=${TUE}`))).toEqual(["You entered Tuesday, December 1st. If that's correct, press 1. To enter a different date, press 2."]);
    expect(redirect(await call("date-confirm", { Digits: "2" }, `p=${medium}&d=${TUE}`))).toBe(`date?p=${medium}`);
    expect(redirect(await call("date-confirm", { Digits: "1" }, `p=${medium}&d=${TUE}`))).toBe(`qty?p=${medium}&d=${TUE}`);
  });

  it("available: straight on to the current booking steps", async () => {
    const xml = await call("qty", {}, `p=${medium}&d=${TUE}`);
    expect(redirect(xml)).toBe(`add?p=${medium}&d=${TUE}&q=1`);
  });

  it("booked: next size up and down (only those free that day), or keep the item and pick another date", async () => {
    await book(medium, TUE);
    expect(redirect(await call("qty", {}, `p=${medium}&d=${TUE}`))).toBe(`booked?p=${medium}&d=${TUE}`);
    const both = await call("booked", {}, `p=${medium}&d=${TUE}`);
    expect(said(both)).toEqual([
      "I'm sorry, the Medium Castle is already booked on Tuesday, December 1st.",
      "Here are the closest options for that day.",
      "For the next size up, the Large Castle, press 1.",
      "For the next size down, the Small Castle, press 2.",
      "To keep the Medium Castle and choose a different date, press 3.",
    ]);
    expect(redirect(await call("booked-choice", { Digits: "1" }, action(both)!.split("?")[1]))).toBe(`qty?p=${large}&d=${TUE}`);
    expect(redirect(await call("booked-choice", { Digits: "2" }, action(both)!.split("?")[1]))).toBe(`qty?p=${small}&d=${TUE}`);
    await book(large, TUE);
    const onlySmall = said(await call("booked", {}, `p=${medium}&d=${TUE}`));
    expect(onlySmall).not.toContain("For the next size up, the Large Castle, press 1.");
    expect(onlySmall).toContain("For the next size down, the Small Castle, press 2.");
    expect(redirect(await call("booked-choice", { Digits: "3" }, `p=${medium}&d=${TUE}&s=${small}`))).toBe(`altdates?p=${medium}&d=${TUE}`);
  });

  it("another date: only days that work with the whole-rental-day rule are offered", async () => {
    // The day before (Monday) would be picked up Tuesday morning, while the castle is out on Tuesday: not offered.
    const xml = await call("altdates", {}, `p=${medium}&d=${TUE}`);
    expect(said(xml)).toEqual([
      "The Medium Castle is available on Wednesday, December 2nd, the day after. To choose that day, press 2.",
      "To try a different date, press 3.",
    ]);
    // An item free on both sides gets both offers
    const both = said(await call("altdates", {}, `p=${large}&d=2026-12-16`));
    expect(both).toEqual([
      "The Large Castle is available on Tuesday, December 15th, the day before. To choose that day, press 1.",
      "It's also available on Thursday, December 17th, the day after. To choose that day, press 2.",
      "To try a different date, press 3.",
    ]);
    expect(redirect(await call("altdate-choice", { Digits: "2" }, action(xml)!.split("?")[1]))).toBe(`qty?p=${medium}&d=2026-12-02`);
    expect(h.session.data.day).toBe("2026-12-02");
    expect(redirect(await call("altdate-choice", { Digits: "3" }, action(xml)!.split("?")[1]))).toBe(`date?p=${medium}`);
  });

  it("neither day open: the nearest open dates before and after (Shabbos skipped)", async () => {
    // Small Castle: Thursday Dec 10 asked; booked Wed 9 and Fri 11; Shabbos 12 closed -> nearest after is Sunday 13;
    // before: Tuesday 8 would be picked up Wednesday morning while it's out on the 9th, so Monday 7
    await book(small, "2026-12-10");
    await book(small, "2026-12-09");
    await book(small, "2026-12-11");
    const xml = await call("altdates", {}, `p=${small}&d=2026-12-10`);
    expect(said(xml)).toEqual([
      "The Small Castle isn't available the day before or after.",
      "The nearest date before your date is Monday, December 7th. To choose it, press 1.",
      "The nearest date after your date is Sunday, December 13th. To choose it, press 2.",
      "To try a different date, press 3.",
    ]);
  });

  it("inside a booking, no key (Abraham, Nov 11): the same step again; 9 minutes the warning; 10 minutes the call ends", async () => {
    const q = `p=${medium}&d=${TUE}`;
    const fall = redirect(await call("booked", {}, q))!;
    expect(fall).toBe(`idle?to=booked&q=${encodeURIComponent(q).replace(/%3D/g, "%3D")}`);
    const enc = fall.split("q=")[1];
    h.session.data = { ...h.session.data, lastKeyAt: Date.now() - 60_000 };
    expect(redirect(await call("idle", {}, `to=booked&q=${enc}`))).toBe(`booked?${q}`); // no 3-play hang-up
    h.session.data = { ...h.session.data, lastKeyAt: Date.now() - 9 * 60_000 - 5_000 };
    const warn = (await call("idle", {}, `to=booked&q=${enc}`)).replace(/&apos;/g, "'");
    expect(warn).toContain("Are you still there? Please press any key to continue. Otherwise, this call will end in one minute.");
    expect(warn).toMatch(/<Gather [^>]*action="[^"]*idle-key/);
    expect(redirect(await call("idle-key", { Digits: "5" }, `to=booked&q=${enc}`))).toBe(`booked?${q}`); // any key: carry on
    h.session.data = { ...h.session.data, lastKeyAt: Date.now() - 10 * 60_000 - 1_000 };
    const end = await call("idle", {}, `to=booked&q=${enc}`);
    expect(end).toContain("<Hangup/>");
    expect(redirect(await call("date", {}, `p=${medium}`))).toMatch(/^idle\?to=date/);
  });

  it("day names and day numbers", () => {
    expect(spokenDate("2026-03-05")).toBe("Thursday, March 5th");
    expect(spokenDate("2026-03-01")).toBe("Sunday, March 1st");
    expect(spokenDate("2026-03-02")).toBe("Monday, March 2nd");
    expect(spokenDate("2026-03-03")).toBe("Tuesday, March 3rd");
    expect(spokenDate("2026-03-11")).toBe("Wednesday, March 11th");
    expect(spokenDate("2026-03-22")).toBe("Sunday, March 22nd");
  });
});
