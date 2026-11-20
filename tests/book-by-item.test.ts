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
      "To receive our catalog by text or email, press 8.",
      "Please note, orders can be placed only through our automated system.",
      "For jumping balloons, press 1. For laser tag, press 2. For paddle boats, press 3.",
      "For information or questions, press 0 for customer service. For schools, corporate events, and organizational bookings, press 9.",
      "To go back, press star.",
    ]); // Nov 19, 2026: three recordings, then the shared star line
    // Jumping balloons now play box 153 (Abraham, Nov 19, 2026)
    expect(redirect(await call("category", {}, `c=${catId}`))).toBe(`balloons?c=${catId}`);
    h.session.data = {};
    expect(redirect(await call("category-choice", { Digits: "2" }, `c=${catId}`))).toBe(`date?p=${medium}`);
    const date = await call("date", {}, `p=${medium}`);
    expect(said(date)).toEqual(["Using your keypad, please enter your event date: two digits for the month, then two digits for the day. For example, for March fifth, press 0, 3, 0, 5.", "To go back, press star."]);
    expect(date).not.toContain('input="dtmf speech"');
    expect(redirect(await call("date-heard", { Digits: "1201" }, `p=${medium}`))).toBe(`date-ask?p=${medium}&d=${TUE}`);
    expect(said(await call("date-ask", {}, `p=${medium}&d=${TUE}`))).toEqual(["You entered Tuesday, December first. If that is correct, press pound to continue. To enter a different date, press 1.", "To go back, press star."]); // Nov 20, 2026: no cart option here
    expect(redirect(await call("date-confirm", { Digits: "1" }, `p=${medium}&d=${TUE}`))).toBe(`date?p=${medium}`);
    expect(redirect(await call("date-confirm", { Digits: "#" }, `p=${medium}&d=${TUE}`))).toBe(`qty?p=${medium}&d=${TUE}`);
  });

  it("available: straight on to the current booking steps", async () => {
    const xml = await call("qty", {}, `p=${medium}&d=${TUE}`);
    expect(redirect(xml)).toBe(`add?p=${medium}&d=${TUE}&q=1`);
  });

  it("item booked (Nov 19, 2026): one line with the closest item of the kind (1) or the nearest date (2); 1 offers the next size up, else down", async () => {
    await book(medium, TUE);
    expect(redirect(await call("qty", {}, `p=${medium}&d=${TUE}`))).toBe(`booked?p=${medium}&d=${TUE}`);
    const taken = await call("booked", {}, `p=${medium}&d=${TUE}`);
    expect(said(taken)).toEqual([
      "I am sorry, the Medium Castle is already booked on Tuesday, December first.",
      "For the closest jumping balloon on the same date, press 1.",
      "For the nearest date this item is free, press 2.",
      "To go to your shopping cart, press 0.",
      "To go back, press star.",
    ]);
    expect(redirect(await call("taken-choice", { Digits: "1" }, `p=${medium}&d=${TUE}`))).toBe(`booked-closest?p=${medium}&d=${TUE}`);
    expect(redirect(await call("taken-choice", { Digits: "2" }, `p=${medium}&d=${TUE}`))).toBe(`altdates?p=${medium}&d=${TUE}`);
    expect(redirect(await call("booked-closest", {}, `p=${medium}&d=${TUE}`))).toBe(`balloon?p=${large}`);
    await book(large, TUE);
    expect(redirect(await call("booked-closest", {}, `p=${medium}&d=${TUE}`))).toBe(`balloon?p=${small}`);
    await book(small, TUE);
    expect(redirect(await call("booked-closest", {}, `p=${medium}&d=${TUE}`))).toBe(`altdates?p=${medium}&d=${TUE}`);
  });

  it("another date: only days that work with the whole-rental-day rule are offered", async () => {
    // The day before (Monday) would be picked up Tuesday morning, while the castle is out on Tuesday: not offered.
    const xml = await call("altdates", {}, `p=${medium}&d=${TUE}`);
    expect(said(xml)).toEqual([
      "The Medium Castle is available on Wednesday, December second, the day after. To choose that day, press 2.",
      "To try a different date, press 3.",
      "To go to your shopping cart, press 0.",
      "To go back, press star.",
    ]);
    // An item free on both sides gets both offers
    const both = said(await call("altdates", {}, `p=${large}&d=2026-12-16`));
    expect(both).toEqual([
      "The Large Castle is available on Tuesday, December fifteenth, the day before. To choose that day, press 1.",
      "It is also available on Thursday, December seventeenth, the day after. To choose that day, press 2.",
      "To try a different date, press 3.",
      "To go to your shopping cart, press 0.",
      "To go back, press star.",
    ]);
    expect(redirect(await call("altdate-choice", { Digits: "2" }, action(xml)!.split("?")[1]))).toBe(`qty?p=${medium}&d=2026-12-02`);
    expect(h.session.data.day).toBe("2026-12-02");
    expect(redirect(await call("altdate-choice", { Digits: "3" }, action(xml)!.split("?")[1]))).toBe(`date?p=${medium}`);
  });

  it("neither day open: the nearest open dates before and after (Shabbes skipped)", async () => {
    // Small Castle: Thursday Dec 10 asked; booked Wed 9 and Fri 11; Shabbes 12 closed -> nearest after is Sunday 13;
    // before: Tuesday 8 would be picked up Wednesday morning while it's out on the 9th, so Monday 7
    await book(small, "2026-12-10");
    await book(small, "2026-12-09");
    await book(small, "2026-12-11");
    const xml = await call("altdates", {}, `p=${small}&d=2026-12-10`);
    expect(said(xml)).toEqual([
      "The Small Castle is not available the day before or after.",
      "The nearest date before your date is Monday, December seventh. To choose it, press 1.",
      "The nearest date after your date is Sunday, December thirteenth. To choose it, press 2.",
      "To try a different date, press 3.",
      "To go to your shopping cart, press 0.",
      "To go back, press star.",
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
    expect(spokenDate("2026-03-05")).toBe("Thursday, March fifth");
    expect(spokenDate("2026-03-01")).toBe("Sunday, March first");
    expect(spokenDate("2026-03-02")).toBe("Monday, March second");
    expect(spokenDate("2026-03-03")).toBe("Tuesday, March third");
    expect(spokenDate("2026-03-11")).toBe("Wednesday, March eleventh");
    expect(spokenDate("2026-03-22")).toBe("Sunday, March twenty-second");
  });
});

describe("a closed day (Abraham, Nov 20, 2026)", () => {
  it("Shabbes with Friday and Sunday open: get it Friday, keep it until Sunday 9:00 AM, 1.5 times; 1 books it; digits are a new date", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-20T15:00:00Z"));
    try {
      h.session.data = {};
      expect(redirect(await call("date-heard", { Digits: "1128" }, `p=${medium}`))).toBe(`closed-offer?p=${medium}&d=2026-11-28`);
      const offer = await call("closed-offer", {}, `p=${medium}&d=2026-11-28`);
      const lines = said(offer);
      expect(lines[0]).toMatch(/^We are closed on Saturday, November twenty-eighth for .+\. You can get it the day before, on Friday, November twenty-seventh, in the morning before 12:00 PM, and keep it until Sunday, November twenty-ninth, at 9:00 AM, for a total of 225 dollars\. To book it, press 1\. Otherwise, please pick another date\.$/);
      expect(lines[1]).toMatch(/^Using your keypad, please enter your event date/);
      expect(lines[2]).toBe("To go back, press star.");
      expect(redirect(await call("closed-offer-choice", { Digits: "1" }, `p=${medium}&d=2026-11-28`))).toBe(`qty?p=${medium}&d=2026-11-27`);
      expect(h.session.data.spanDays).toEqual({ "2026-11-27": { after: "2026-11-29", days: 1.5 } });
      expect(redirect(await call("closed-offer-choice", { Digits: "1201" }, `p=${medium}&d=2026-11-28`))).toBe(`date-ask?p=${medium}&d=2026-12-01`);
    } finally {
      vi.useRealTimers();
    }
  });
});
