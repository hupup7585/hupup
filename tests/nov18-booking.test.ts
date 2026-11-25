import { beforeAll, describe, expect, it, vi } from "vitest";

/* Booking flow changes (Abraham, Nov 18, 2026): box 150 and box 149 (approved), one item at a time, laser tag and paddle
 * boats "one more" (not approved yet: preview only). In-memory database; nothing is sent for real. */
const h = vi.hoisted(() => ({
  session: { callSid: "CAn18", fromNumber: "+18455550188", orderId: null as number | null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing" },
}));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/session", () => ({
  ensureSession: async () => h.session,
  getSession: async () => h.session,
  updateSession: async (_sid: string, patch: Record<string, unknown> & { data?: Record<string, unknown> }) =>
    Object.assign(h.session, { ...patch, data: { ...h.session.data, ...(patch.data ?? {}) } }),
}));
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));
vi.mock("@/lib/business-hours", async (orig) => ({ ...(await orig<typeof import("@/lib/business-hours")>()), officeOpenNow: () => true, lateHoursToday: () => null }));
vi.mock("@/lib/notify", () => ({ sendSms: async () => ({ sent: true }), sendEmail: async () => ({ sent: true }), sendMessage: async () => ({ sent: true }) }));

import { handleVoice } from "@/lib/ivr/flow";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";

const call = (action: string, body: Record<string, string> = {}, query = "") =>
  handleVoice({ action, query: new URLSearchParams(query), body: { CallSid: h.session.callSid, ...body }, callSid: h.session.callSid, from: "+18455550188" });
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace("https://hupup.example/api/voice/", "").replace(/&amp;/g, "&");
const said = (xml: string) => [...xml.matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => m[1].replace(/&apos;/g, "'").replace(/&amp;/g, "&"));

const CHANUKAH_FRIDAY = "2026-12-11"; // Chanukah 2026; Shabbes December 12 is not Yom Tov
const PLAIN_FRIDAY = "2026-11-27";
let castle = 0;
let boat = 0;

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  process.env.AUTH_SECRET = "test-secret";
  const [b] = await db.insert(schema.categories).values({ name: "Jumping Balloons", spokenName: "Jumping Balloons", ivrDigit: 1, sortOrder: 1, active: true }).returning();
  const [pb] = await db.insert(schema.categories).values({ name: "Paddle Boats", spokenName: "Paddle Boats", ivrDigit: 3, sortOrder: 3, active: true }).returning();
  castle = (await db.insert(schema.products).values({ categoryId: b.id, name: "Castle", priceCents: 20000, quantity: 3, active: true, sortOrder: 1 }).returning())[0].id;
  boat = (await db.insert(schema.products).values({ categoryId: pb.id, name: "Paddle boat", priceCents: 10000, quantity: 2, active: true, sortOrder: 1 }).returning())[0].id;
});

describe("box 150 and box 149 (approved Nov 18, 2026)", () => {
  it("box 150 plays only for a Friday in Chanukah or Chol Hamoed; every other date keeps the normal check", async () => {
    expect(said(await call("date-ask", {}, `p=${castle}&d=${CHANUKAH_FRIDAY}`))).toEqual([
      "You entered Friday, December eleventh. If that is correct, press 1. To keep your rental for Mutze Shabbes, press 2. To enter a different date, press 3.", // approved Nov 24, 2026
      "To go back, press star.",
    ]);
    expect(said(await call("date-ask", {}, `p=${castle}&d=${PLAIN_FRIDAY}`))[0]).toMatch(/^To book the .+ for Friday, November twenty-seventh, press 1\.$/); // box 18 (Nov 22, 2026)
  });
  it("box 150: 2 = a different date", async () => {
    expect(redirect(await call("date-confirm", { Digits: "3" }, `p=${castle}&d=${CHANUKAH_FRIDAY}&f=1`))).toBe(`date?p=${castle}`);
  });
  it("box 150: 1 = Mutze Shabbes, then box 149 with the real price for one and a half days and the Sunday pickup", async () => {
    const xml = await call("date-confirm", { Digits: "2" }, `p=${castle}&d=${CHANUKAH_FRIDAY}&f=1`); // 2 = Mutze Shabbes (Nov 24, 2026)
    expect(said(xml)).toContain("For Friday and Mutze Shabbes, you will be charged for only one and a half days, a total of 300 dollars. Your rental will be picked up on Sunday, December thirteenth, at 9:00 AM. Please make sure it is ready outside on time.");
    expect(redirect(xml)).toBe(`qty?p=${castle}&d=${CHANUKAH_FRIDAY}`);
    // one item, no "How many" question; the booking is picked up Sunday and priced at one and a half days
    expect(redirect(await call("qty", {}, `p=${castle}&d=${CHANUKAH_FRIDAY}`))).toBe(`add?p=${castle}&d=${CHANUKAH_FRIDAY}&q=1`);
    await call("add", {}, `p=${castle}&d=${CHANUKAH_FRIDAY}&q=1`);
    const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, h.session.orderId!));
    expect(o.pickupDate).toBe("2026-12-13");
    expect(o.subtotalCents).toBe(30000);
    expect(o.offerNote).toBe("Friday and Mutze Shabbes: one and a half days");
  });
  it("box 150: pound = Friday only (picked up after Shabbes, one day's price); the Friday only line is preview only", async () => {
    h.session.orderId = null;
    h.session.data = {};
    const xml = await call("date-confirm", { Digits: "1" }, `p=${boat}&d=${CHANUKAH_FRIDAY}&f=1`); // 1 = Friday only (Nov 24, 2026)
    expect(said(xml)).toContain("For Friday, you will be charged for one full day, a total of 100 dollars. Your rental will be picked up one hour after Shabbes. Please make sure it is ready outside on time.");
    expect((h.session.data.mutzeDays as string[]).includes(CHANUKAH_FRIDAY)).toBe(false);
    process.env.VERCEL_ENV = "production";
    try {
      expect(said(await call("date-confirm", { Digits: "1" }, `p=${boat}&d=${CHANUKAH_FRIDAY}&f=1`)).join(" ")).not.toContain("one full day");
    } finally {
      delete process.env.VERCEL_ENV;
    }
  });
});

describe("one item at a time (Nov 18, 2026); box 151 and box 152 (approved Nov 19)", () => {
  it("no quantity question anywhere; never how many are in stock", async () => {
    const { PROMPTS } = await import("@/lib/ivr/prompts");
    const { readFileSync } = await import("node:fs");
    const f = readFileSync("src/lib/ivr/flow.ts", "utf8");
    expect(f).not.toContain('"qty_prompt"');
    expect(PROMPTS).not.toHaveProperty("qty_prompt"); // removed (Nov 20, 2026)
    expect(PROMPTS).not.toHaveProperty("qty_invalid");
  });
  it("Nov 22, 2026: paddle boats and laser tag get box 25 like every item; box 151 and box 152 are dropped", async () => {
    h.session.orderId = null;
    h.session.data = {};
    const day = "2026-12-21";
    expect(redirect(await call("add", {}, `p=${boat}&d=${day}&q=1`))).toBe(`added-second?p=${boat}&d=${day}`); // box 25 with the second one (Nov 22, 3:13 PM)
    expect(said(await call("added-menu"))).toEqual(["Successfully added to your cart: 1 Paddle boat for Monday, December twenty-first.", "To keep shopping, for same day, press 1. For another day, press 2.", "To go to your shopping cart, press 0.", "To go back, press star."]);
    expect(redirect(await call("another", {}, `p=${boat}&d=${day}`))).toBe("added-menu"); // a call still on the old step
    const { PROMPTS } = await import("@/lib/ivr/prompts");
    for (const k of ["box151", "box151_none", "box152"]) expect(PROMPTS).not.toHaveProperty(k);
  });
  it("jumping balloons never offer a second one", async () => {
    h.session.orderId = null;
    h.session.data = {};
    expect(redirect(await call("add", {}, `p=${castle}&d=2026-12-22&q=1`))).toBe("added-menu?o=2026-12-22"); // the ocean balls offer in box 25 (Nov 25, 2026, 14:08)
  });
});

describe("box 150 keys (approved Nov 24, 2026)", () => {
  it("pound is no longer a key there; star is a different date", async () => {
    const xml = await call("date-confirm", { Digits: "#" }, `p=${castle}&d=${CHANUKAH_FRIDAY}&f=1`);
    expect(said(xml)).toEqual(["Sorry, that is not a valid selection."]);
    expect(redirect(await call("date-confirm", { Digits: "*" }, `p=${castle}&d=${CHANUKAH_FRIDAY}&f=1`))).toBe(`date?p=${castle}`);
  });
});
