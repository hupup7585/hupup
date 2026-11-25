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
      "The fastest way to place an order is with our easy automated system.", // Nov 25, 2026, 2:02 PM
      "For information or questions, press 0 for customer service.",
      "For jumping balloons, press 1. For laser tag, press 2. For paddle boats, press 3.",
      "For schools, corporate events, and organizational bookings, press 9.",
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
    // Box 18 (Abraham, Nov 22, 2026): the item is known; no cart option here
    const box18 = said(await call("date-ask", {}, `p=${medium}&d=${TUE}`));
    expect(box18[0]).toMatch(/^To book the .+ for Tuesday, December first, press 1\.$/);
    expect(box18.slice(-2)).toEqual(["To choose a different date, press 3.", "To go back, press star."]);
    expect(redirect(await call("box18-choice", { Digits: "3" }, `p=${medium}&d=${TUE}&t=1`))).toBe(`date?p=${medium}`);
    expect(redirect(await call("box18-choice", { Digits: "1" }, `p=${medium}&d=${TUE}&t=1`))).toBe(`qty?p=${medium}&d=${TUE}`);
    // with no item yet, the old check stays (still open with Abraham)
    expect(said(await call("date-ask", {}, `d=${TUE}`))).toEqual(["You entered Tuesday, December first.", "If that is correct, press 1. To try again, press 2.", "To go back, press star."]);
    expect(redirect(await call("date-confirm", { Digits: "1" }, `p=${medium}&d=${TUE}`))).toBe(`qty?p=${medium}&d=${TUE}`);
  });

  it("available: straight on to the current booking steps", async () => {
    const xml = await call("qty", {}, `p=${medium}&d=${TUE}`);
    expect(redirect(xml)).toBe(`add?p=${medium}&d=${TUE}&q=1`);
  });

  it("item taken (Nov 20, 2026): one prompt; 1 = the free items of that category on that date; 2 = the nearest available date", async () => {
    await book(medium, TUE);
    expect(redirect(await call("qty", {}, `p=${medium}&d=${TUE}`))).toBe(`booked?p=${medium}&d=${TUE}`);
    const taken = await call("booked", {}, `p=${medium}&d=${TUE}`);
    expect(said(taken)).toEqual([
      "We are sorry, the Medium Castle is no longer available for Tuesday, December first. To check the closest available jumping balloon on the same date, press 1. For the nearest available date, press 2.",
      "To go to your shopping cart, press 0.",
      "To go back, press star.",
    ]);
    h.session.data = {};
    expect(redirect(await call("taken-choice", { Digits: "1" }, `p=${medium}&d=${TUE}`))).toBe(`category?c=${catId}&f=${TUE}`);
    expect(h.session.data.day).toBe(TUE);
    // only the free items: the Medium Castle is not in the list for that date
    expect(redirect(await call("category-choice", { Digits: "2" }, `c=${catId}&f=${TUE}`))).toBe(`qty?p=${large}&d=${TUE}`);
    expect(redirect(await call("taken-choice", { Digits: "2" }, `p=${medium}&d=${TUE}`))).toBe(`nearest-date?p=${medium}&d=${TUE}`);
    expect(redirect(await call("taken-choice", { Digits: "0" }, `p=${medium}&d=${TUE}`))).toBe("cart");
    // old screens send a call still in them to the one prompt
    for (const old of ["booked-near", "booked-same", "booked-closest", "altdates"]) expect(redirect(await call(old, {}, `p=${medium}&d=${TUE}`))).toBe(`booked?p=${medium}&d=${TUE}`);
  });
  it("no key, system-wide (Nov 22, 2026): after 5 seconds the no-choice line and the same screen; the call ends after 1 full minute with no key", async () => {
    const q = `p=${medium}&d=${TUE}`;
    const screen = await call("booked", {}, q);
    expect(screen).toMatch(/<Gather [^>]*timeout="5"/);
    const fall = redirect(screen)!;
    expect(fall).toBe(`idle?to=booked&q=${encodeURIComponent(q).replace(/%3D/g, "%3D")}`);
    const enc = fall.split("q=")[1];
    const first = await call("idle", {}, `to=booked&q=${enc}`);
    expect(said(first)).toEqual(["We did not get your choice. Please try again."]);
    const again = redirect(first)!;
    expect(again).toMatch(new RegExp(`^booked\\?${q.replace("?", "\\?")}&nk=\\d+$`));
    const nk = Number(again.split("nk=")[1]);
    // still under a minute: the same screen again
    expect(redirect(await call("idle", {}, `to=booked&q=${enc}&nk=${nk}`))).toBe(`booked?${q}&nk=${nk}`);
    // a full minute with no key: the goodbye line, then the call ends
    const end = await call("idle", {}, `to=booked&q=${enc}&nk=${Date.now() - 61_000}`);
    expect(said(end)).toEqual(["It sounds like we got disconnected, but you can call us back at any time. Thank you for calling Hup Up Attractions. Bye for now!"]);
    expect(end).toContain("<Hangup/>");
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
      // Box 17 in pieces (Abraham, Nov 22, 2026): 1 books it, 2 another date, star back
      expect(lines[0]).toMatch(/^We are closed on Saturday, November twenty-eighth for .+\.$/);
      expect(lines.slice(1)).toEqual(["You can get it the day before, on Friday, November twenty-seventh, and keep it until Sunday, November twenty-ninth, at 9:00 AM, for a total of 225 dollars.", "To book it, press 1.", "To pick another date, press 2.", "To go back, press star."]);
      expect(redirect(await call("closed-offer-choice", { Digits: "1" }, `p=${medium}&d=2026-11-28`))).toBe(`qty?p=${medium}&d=2026-11-27`);
      expect(h.session.data.spanDays).toEqual({ "2026-11-27": { after: "2026-11-29", days: 1.5 } });
      expect(redirect(await call("closed-offer-choice", { Digits: "2" }, `p=${medium}&d=2026-11-28`))).toBe(`date?p=${medium}`);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("item taken, key 2 (Nov 20, 2026)", () => {
  it("the nearest available date: the draft line on preview (1 books it), then the date prompt and the back line; live: the date prompt only", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-20T15:00:00Z"));
    try {
      const xml = await call("nearest-date", {}, `p=${medium}&d=2026-12-01`);
      const lines = said(xml);
      expect(lines[0]).toMatch(/^The Medium Castle is available on .+\. To book it for that date, press 1\. Otherwise, please pick another date\.$/);
      expect(lines.slice(-2)[1]).toBe("To go back, press star.");
      const near = xml.match(/nearest-choice\?p=\d+&amp;n=([0-9-]+)/)![1];
      expect(redirect(await call("nearest-choice", { Digits: "1" }, `p=${medium}&n=${near}`))).toBe(`qty?p=${medium}&d=${near}`);
      process.env.VERCEL_ENV = "production";
      const live = said(await call("nearest-date", {}, `p=${medium}&d=2026-12-01`));
      expect(live[0]).toMatch(/^Using your keypad, please enter your event date/);
    } finally {
      delete process.env.VERCEL_ENV;
      vi.useRealTimers();
    }
  });
});
