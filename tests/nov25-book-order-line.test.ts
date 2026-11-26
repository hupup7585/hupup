import { beforeAll, describe, expect, it, vi } from "vitest";

/* Item 1 (Abraham, y, Nov 25, 2026, 2:02 PM): the bookings menu's second line (first time only) is now
 * "The fastest way to place an order is with our easy automated system."; automated_only is retired. */
const h = vi.hoisted(() => ({ overrides: {} as Record<string, unknown> }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/jewish-calendar", async (orig) => ({ ...(await orig<typeof import("@/lib/jewish-calendar")>()), isShabbosOrYomTov: () => false, bookingLock: () => ({ locked: false }) }));
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => h.overrides }));
vi.mock("@/lib/business-hours", async (orig) => ({ ...(await orig<typeof import("@/lib/business-hours")>()), officeOpenNow: () => true, lateHoursToday: () => null }));
vi.mock("@/lib/hours-schedule", async (orig) => ({ ...(await orig<typeof import("@/lib/hours-schedule")>()), lineOpen: () => true })); // each line follows the test's open/closed (Hours page, Nov 25, 2026)
vi.mock("@/lib/notify", () => ({ sendSms: async () => ({ sent: true }), sendEmail: async () => ({ sent: true }) }));

import { db, schema } from "@/lib/db";
import { handleVoice } from "@/lib/ivr/flow";
import { PROMPTS, RETIRED_PROMPTS } from "@/lib/ivr/prompts";

const NEW = "The fastest way to place an order is with our easy automated system.";
const OLD = "Please note, orders can be placed only through our automated system.";
const SID = "CAbookline";
const call = (action: string, body: Record<string, string> = {}, q: Record<string, string> = {}) =>
  handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: SID, ...body }, callSid: SID, from: "+18455550144" });
const said = (xml: string) => [...xml.matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => m[1].replace(/&apos;/g, "'").replace(/&amp;/g, "&"));

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  await call("incoming");
});

describe("item 1: the bookings menu order line", () => {
  it("slot text and label; automated_only retired and played nowhere", async () => {
    expect(PROMPTS.book_orders_only.text).toBe(NEW);
    expect(PROMPTS.book_orders_only.label).toBe("Bookings menu, recording 1b: fastest way to order (first time only)");
    expect(RETIRED_PROMPTS.has("automated_only")).toBe(true);
    const { lineStatus } = await import("@/lib/prompt-status");
    expect(lineStatus("automated_only", {}).status).toBe("Not used");
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("src/lib/ivr/flow.ts", "utf8")).not.toContain('"automated_only"');
  });
  it("first visit: the new line right after the catalog line; the old text is gone", async () => {
    const xml = await call("book");
    const lines = said(xml);
    expect(lines[lines.indexOf(PROMPTS.book_r1.text) + 1]).toBe(NEW);
    expect(xml).not.toContain(OLD);
  });
  it("back in the bookings menu with something in the cart (the same first-time rule as before): not played", async () => {
    const [c] = await db.insert(schema.categories).values({ name: "Jumping Balloons", ivrDigit: 1, sortOrder: 1, active: true }).returning();
    const [p] = await db.insert(schema.products).values({ categoryId: c.id, name: "Royal Castle", priceCents: 20000, quantity: 3, active: true }).returning();
    await call("add", {}, { p: String(p.id), d: "2027-03-15", q: "1" });
    const lines = said(await call("book"));
    expect(lines).toContain(PROMPTS.book_r1.text);
    expect(lines).not.toContain(NEW);
  });
});

describe("item 2: customer service hours line 3c (Abraham, Yes, Nov 25, 2026, 3:25 PM)", () => {
  const R3C = "Our customer service is open Sunday through Thursday, from 11 AM to 4 PM.";
  it("slot text exact, own Admin slot", () => {
    expect(PROMPTS.book_r3c.text).toBe(R3C);
    expect(PROMPTS.book_r3c.label).toBe("Bookings menu, recording 3c: customer service hours");
    expect(RETIRED_PROMPTS.has("book_r3c")).toBe(false);
  });
  it("4:50 PM: not played anywhere (the hours changed); the slot keeps its text and shows Waiting for new wording", async () => {
    const lines = said(await call("book"));
    expect(lines).not.toContain(R3C);
    expect(lines).toContain(PROMPTS.book_r3a.text);
    const { lineStatus } = await import("@/lib/prompt-status");
    expect(lineStatus("book_r3c", {})).toEqual({ status: "Not active yet", reason: "Waiting for new wording." });
  });
});
