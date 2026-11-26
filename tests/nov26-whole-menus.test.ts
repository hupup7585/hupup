import { beforeAll, describe, expect, it, vi } from "vitest";

/* Whole menus (Abraham, Nov 26, 2026): one more recording slot per phone menu for all its fixed lines together. Once a
 * recording is chosen for it, it plays instead of the separate lines; dates, prices, names and totals still play on
 * their own; the separate line slots stay exactly as they are. */
const h = vi.hoisted(() => ({ overrides: {} as Record<string, unknown> }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/jewish-calendar", async (orig) => ({ ...(await orig<typeof import("@/lib/jewish-calendar")>()), isShabbosOrYomTov: () => false, bookingLock: () => ({ locked: false }) }));
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => h.overrides }));
vi.mock("@/lib/business-hours", async (orig) => ({ ...(await orig<typeof import("@/lib/business-hours")>()), officeOpenNow: () => true, lateHoursToday: () => null }));
vi.mock("@/lib/notify", () => ({ sendSms: async () => ({ sent: true }), sendEmail: async () => ({ sent: true }) }));

import { db, schema } from "@/lib/db";
import { handleVoice } from "@/lib/ivr/flow";
import { MENU_COMBOS, PROMPTS, promptRecordable, type PromptKey } from "@/lib/ivr/prompts";
import { allSlots } from "@/lib/recording-slots";

const SID = "CAwhole";
const call = (action: string, body: Record<string, string> = {}, q: Record<string, string> = {}) =>
  handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: SID, ...body }, callSid: SID, from: "+18455550148" });
const said = (xml: string) => [...xml.matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => m[1].replace(/&apos;/g, "'").replace(/&amp;/g, "&"));
const plays = (xml: string) => [...xml.matchAll(/<Play>([^<]+)<\/Play>/g)].map((m) => m[1]);
const T = (k: string) => PROMPTS[k as PromptKey].text;
let product = 0;

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  const [c] = await db.insert(schema.categories).values({ name: "Jumping Balloons", ivrDigit: 1, sortOrder: 1, active: true }).returning();
  const [p] = await db.insert(schema.products).values({ categoryId: c.id, name: "Royal Castle", priceCents: 20000, quantity: 3, active: true }).returning();
  product = p.id;
  await call("incoming");
});

describe("the slots", () => {
  it("one whole-menu slot per menu: its text is its lines in order; recordable in Admin; the line slots are unchanged", () => {
    const slots = new Map(allSlots().map((s) => [s.key, s]));
    for (const [id, parts] of Object.entries(MENU_COMBOS)) {
      const key = `whole_${id}`;
      expect(T(key)).toBe(parts.filter((x) => x !== "pause").map((x) => (x === "star" ? T("book_back") : T(x))).join(" "));
      expect(promptRecordable(key as PromptKey)).toBe(true);
      expect(slots.get(key)?.kind).toBe("line");
      for (const x of parts) if (x !== "star" && x !== "pause") expect(slots.has(x) || PROMPTS[x as PromptKey]).toBeTruthy();
    }
    expect(T("whole_book_r2")).toBe("For jumping balloons, press 1. For laser tag, press 2. For paddle boats, press 3. To go to your shopping cart, press 0. To go back, press star.");
    expect(T("book_r2")).toBe("For jumping balloons, press 1. For laser tag, press 2. For paddle boats, press 3.");
    expect(slots.get("book_r2")?.kind).toBe("line");
  });
});

describe("on the call", () => {
  it("no whole recording chosen: the separate lines, as before", async () => {
    h.overrides = {};
    expect(said(await call("cats"))).toEqual([T("book_r2"), T("cart_key"), T("book_back")]);
  });
  it("a whole recording chosen: it plays instead of the separate lines", async () => {
    h.overrides = { whole_book_r2: { recordingId: 501 } };
    const xml = await call("cats");
    expect(said(xml)).toEqual([]);
    expect(plays(xml).filter((u) => /501/.test(u))).toHaveLength(1);
    h.overrides = {};
  });
  it("prices still play on their own: the item menu keeps its price line, the fixed options become one recording", async () => {
    h.overrides = { whole_product_options: { recordingId: 502 } };
    const xml = await call("product", {}, { p: String(product) });
    expect(said(xml).join(" ")).toContain("200 dollars");
    expect(said(xml).join(" ")).not.toContain(T("product_options"));
    expect(plays(xml).filter((u) => /502/.test(u))).toHaveLength(1);
    h.overrides = {};
  });
  it("the bookings menu: the first-time recording the first time; the separate lines when its lines differ", async () => {
    h.overrides = { whole_book: { recordingId: 503 } };
    const xml = await call("book");
    expect(said(xml)).toEqual([]);
    expect(plays(xml).filter((u) => /503/.test(u))).toHaveLength(1);
    const { saveSetting } = await import("@/lib/settings");
    await saveSetting("menuOrders", JSON.stringify({ book: ["book_r2", "book_r1", "book_orders_only", "book_r3a", "book_r3b", "book_back"] }));
    expect(said(await call("book"))[0]).toBe(T("book_r2")); // the Owner's own order: not what was recorded, so the separate lines
    await saveSetting("menuOrders", "");
    h.overrides = {};
  });
});
