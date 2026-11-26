import { beforeAll, describe, expect, it, vi } from "vitest";

/* Item taken, nearest options (Abraham, Nov 25, 2026, 8:08 PM). Wording waits for his OK: until then the live voice says
 * the exact text. Key 1: next size down / up free that day. Key 2: the open day before / after, else the nearest dates. */
const h = vi.hoisted(() => ({
  session: { callSid: "CAtaken", fromNumber: "+18455550147", orderId: null as number | null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing", startedAt: new Date() },
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

import { db, schema } from "@/lib/db";
import { reserveItem } from "@/lib/orders";
import { handleVoice } from "@/lib/ivr/flow";
import { PROMPTS, promptWaiting } from "@/lib/ivr/prompts";

const call = (action: string, body: Record<string, string> = {}, q: Record<string, string> = {}) =>
  handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: "CAtaken", ...body }, callSid: "CAtaken", from: "+18455550147" });
const said = (xml: string) => [...xml.matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => m[1].replace(/&apos;/g, "'").replace(/&amp;/g, "&"));
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace(/^.*\/api\/voice\//, "").replace(/&amp;/g, "&");
const STAR = "To go back, press star.";

let small = 0, mid = 0, big = 0, catId = 0;
const book = async (productId: number, date: string) => {
  const r = await reserveItem({ orderId: null, productId, qty: 1, eventDate: date, channel: "POS", status: "CONFIRMED" });
  if (!r.ok) throw new Error(`could not book ${productId} on ${date}`);
};

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  const [c] = await db.insert(schema.categories).values({ name: "Jumping Balloons", ivrDigit: 1, sortOrder: 1, active: true }).returning();
  catId = c.id;
  const made = await db
    .insert(schema.products)
    .values([
      { categoryId: c.id, name: "Little Hop", priceCents: 15000, quantity: 1, active: true, sortOrder: 1, sizeOrder: 1 },
      { categoryId: c.id, name: "Royal Castle", priceCents: 20000, quantity: 1, active: true, sortOrder: 2, sizeOrder: 2 },
      { categoryId: c.id, name: "Mega Slide", priceCents: 30000, quantity: 1, active: true, sortOrder: 3, sizeOrder: 3 },
    ])
    .returning();
  [small, mid, big] = made.map((x) => x.id);
});

describe("the held slots (waiting for Abraham, exact text)", () => {
  it("seven slots with the exact texts; all waiting", () => {
    const want: Record<string, string> = {
      taken_size_down: "For the next size down, the {item}, press 1.",
      taken_size_up: "For the next size up, the {item}, press 2.",
      taken_day_before: "The {item} is available on {date}, the day before. To choose that day, press 1.",
      taken_day_after: "It is also available on {date}, the day after. To choose that day, press 2.",
      taken_day_after_only: "The {item} is available on {date}, the day after. To choose that day, press 2.",
      taken_nearest_before: "The nearest date before your date is {date}. To choose it, press 1.",
      taken_nearest_after: "The nearest date after your date is {date}. To choose it, press 2.",
    };
    for (const [k, t] of Object.entries(want)) {
      expect(PROMPTS[k as keyof typeof PROMPTS].text).toBe(t);
      expect(promptWaiting({}, k as keyof typeof PROMPTS)).toBe(true);
    }
  });
});

describe("key 1: the next size down and up, free that day", () => {
  it("both sizes free: down on 1, up on 2, then the cart and star lines; 1 books the smaller one straight to quantity", async () => {
    const day = "2027-01-12"; // Tuesday
    await book(mid, day);
    expect(redirect(await call("taken-choice", { Digits: "1" }, { p: String(mid), d: day }))).toBe(`taken-size?p=${mid}&d=${day}`);
    const xml = await call("taken-size", {}, { p: String(mid), d: day });
    const lines = said(xml);
    expect(lines.slice(0, 2)).toEqual(["For the next size down, the Little Hop, press 1.", "For the next size up, the Mega Slide, press 2."]);
    expect(lines.at(-1)).toBe(STAR);
    expect(redirect(await call("taken-size-choice", { Digits: "1" }, Object.fromEntries(new URL(xml.match(/action="([^"]+taken-size-choice[^"]*)"/)![1].replace(/&amp;/g, "&")).searchParams)))).toBe(`qty?p=${small}&d=${day}`);
    expect(redirect(await call("taken-size-choice", { Digits: "*" }, { p: String(mid), d: day }))).toBe(`booked?p=${mid}&d=${day}`);
  });
  it("one side only: the bigger one is taken too, so only the size down is offered", async () => {
    const day = "2027-01-13";
    await book(mid, day);
    await book(big, day);
    const lines = said(await call("taken-size", {}, { p: String(mid), d: day }));
    expect(lines[0]).toBe("For the next size down, the Little Hop, press 1.");
    expect(lines.join(" ")).not.toContain("next size up");
  });
  it("none free: nothing extra, the category list for that day as before", async () => {
    const day = "2027-01-14";
    for (const x of [small, mid, big]) await book(x, day);
    expect(redirect(await call("taken-size", {}, { p: String(mid), d: day }))).toBe(`category?c=${catId}&f=${day}`);
  });
});

describe("key 2: the same item on the day before and after", () => {
  it("both free: the day before on 1, the day after on 2 (weekday, month, ordinal day)", async () => {
    const day = "2027-01-19"; // Tuesday
    await book(big, day);
    const xml = await call("nearest-date", {}, { p: String(big), d: day });
    expect(said(xml).slice(0, 2)).toEqual([
      "The Mega Slide is available on Monday, January eighteenth, the day before. To choose that day, press 1.",
      "It is also available on Wednesday, January twentieth, the day after. To choose that day, press 2.",
    ]);
    expect(said(xml).at(-1)).toBe(STAR);
    expect(redirect(await call("nearest-choice", { Digits: "2" }, { p: String(big), d: day, b: "2027-01-18", a: "2027-01-20" }))).toBe(`qty?p=${big}&d=2027-01-20`);
    expect(redirect(await call("nearest-choice", { Digits: "*" }, { p: String(big), d: day }))).toBe(`booked?p=${big}&d=${day}`);
  });
  it("only the day after free: the day-after-only line", async () => {
    const day = "2027-01-26";
    await book(big, day);
    await book(big, "2027-01-25");
    const lines = said(await call("nearest-date", {}, { p: String(big), d: day }));
    expect(lines[0]).toBe("The Mega Slide is available on Wednesday, January twenty-seventh, the day after. To choose that day, press 2.");
    expect(lines.join(" ")).not.toContain("the day before");
  });
  it("neither free: the nearest date before and after", async () => {
    for (const d of ["2027-02-01", "2027-02-02", "2027-02-03"]) await book(small, d); // Mon, Tue, Wed
    const lines = said(await call("nearest-date", {}, { p: String(small), d: "2027-02-02" }));
    expect(lines.slice(0, 2)).toEqual([
      "The nearest date before your date is Sunday, January thirty-first. To choose it, press 1.",
      "The nearest date after your date is Thursday, February fourth. To choose it, press 2.",
    ]);
  });
  it("a closed day is skipped: on a Sunday the day before is Friday, not Shabbes", async () => {
    const day = "2027-01-10"; // Sunday
    await book(mid, day);
    const lines = said(await call("nearest-date", {}, { p: String(mid), d: day }));
    expect(lines[0]).toMatch(/^The Royal Castle is available on Friday, January eighth, the day before\./);
    expect(lines.join(" ")).not.toContain("Saturday");
  });
});
