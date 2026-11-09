import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/* Caller journey (Abraham S): every step of a call is logged; dashboard counts; no card numbers. In-memory database. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));
vi.mock("@/lib/notify", () => ({ sendSms: async () => ({ sent: true }), sendEmail: async () => ({ sent: true }), sendOrderText: async () => ({ texted: true }) }));

import { db, schema } from "@/lib/db";
import { handleCallStatus, handleVoice } from "@/lib/ivr/flow";
import { callJourney, journeyStats, redactDigits } from "@/lib/call-journey";
import { addDays, todayISO } from "@/lib/dates";

const SID = "CAjourney1";
const call = (action: string, body: Record<string, string> = {}, q: Record<string, string> = {}) =>
  handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: SID, ...body }, callSid: SID, from: "+18455550199" });
let productId = 0;
let catId = 0;

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  const [cat] = await db.insert(schema.categories).values({ name: "Bounce Houses", sortOrder: 1, active: true, ivrDigit: 1 }).returning();
  const [p] = await db.insert(schema.products).values({ categoryId: cat.id, name: "Castle Bouncer", priceCents: 15000, quantity: 1, active: true, sortOrder: 1 }).returning();
  catId = cat.id;
  productId = p.id;
});

/** A weekday at least 3 days out that isn't Friday/Shabbos, as MMDD. */
function workday() {
  for (let i = 3; i < 20; i++) {
    const d = addDays(todayISO(), i);
    const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (wd >= 0 && wd <= 4) return d;
  }
  throw new Error("no day");
}

describe("caller journey", () => {
  it("logs menus, keys, the date asked, the category and item heard, what was added, and where the caller hung up", async () => {
    const day = workday();
    await call("incoming");
    await call("menu", {}, { first: "1" });
    await call("menu-choice", { Digits: "1" });
    await call("date-heard", { Digits: day.slice(5, 7) + day.slice(8, 10) });
    await call("date-confirm", { Digits: "1" }, { d: day });
    await call("category", {}, { c: String(catId) });
    await call("product", {}, { p: String(productId) });
    await call("product-choice", { Digits: "1" }, { p: String(productId) });
    await call("add", {}, { p: String(productId), d: day, q: "1" });
    await call("cart");
    await handleCallStatus(SID, "completed");

    const ev = await callJourney(SID);
    const kinds = ev.map((e) => e.kind);
    for (const k of ["step", "date_asked", "category_heard", "item_heard", "item_details", "item_added", "hung_up"]) expect(kinds).toContain(k);
    expect(ev.find((e) => e.label.startsWith("Main menu key 1"))?.label).toBe("Main menu key 1: book a rental");
    expect(ev.find((e) => e.kind === "date_asked")?.detail).toMatchObject({ date: day });
    expect(ev.find((e) => e.kind === "item_added")?.detail).toMatchObject({ item: "Castle Bouncer", qty: 1, date: day });
    const end = ev.at(-1)!;
    expect(end.kind).toBe("hung_up");
    expect(end.label).toBe("Hung up at: Shopping cart");
    expect(end.detail).toMatchObject({ booked: false, lastStep: "cart" });

    const stats = await journeyStats(30);
    expect(stats.topItems[0]).toEqual({ name: "Castle Bouncer", heard: 1, added: 1 });
    expect(stats.topDates[0]).toEqual({ date: day, calls: 1 });
    expect(stats.dropOff[0]).toEqual({ step: "Shopping cart", calls: 1 });
  });

  it("records an item that's unavailable on the date asked", async () => {
    const day = workday();
    const SID2 = "CAjourney2";
    const [o] = await db.insert(schema.orders).values({ status: "CONFIRMED", channel: "PHONE", eventDate: day, pickupDate: addDays(day, 1) }).returning();
    await db.insert(schema.orderItems).values({ orderId: o.id, productId, qty: 1, unitPriceCents: 15000 });
    await handleVoice({ action: "qty", query: new URLSearchParams({ p: String(productId), d: day }), body: { CallSid: SID2 }, callSid: SID2, from: "+18455550198" });
    const ev = await callJourney(SID2);
    expect(ev.find((e) => e.kind === "unavailable")?.detail).toMatchObject({ item: "Castle Bouncer", date: day });
    expect((await journeyStats(30)).unavailable[0]).toEqual({ name: "Castle Bouncer", times: 1 });
  });

  it("never stores card-length numbers (or long digit runs outside the phone-number step)", () => {
    expect(redactDigits("my card is 4111 1111 1111 1111")).toBe("my card is [number removed]");
    expect(redactDigits("4111111111111111", true)).toBe("[number removed]");
    expect(redactDigits("call me at 845-555-0199", true)).toBe("call me at 845-555-0199");
    expect(redactDigits("code 123")).toBe("code 123");
    expect(readFileSync("src/lib/ivr/flow.ts", "utf8")).not.toMatch(/<Pay|\.pay\(/);
  });

  it("the call log shows each call's journey; the dashboard shows the counts", () => {
    expect(readFileSync("src/app/admin/(app)/calls/page.tsx", "utf8")).toContain("<Timeline events={ev}");
    expect(readFileSync("src/app/admin/(app)/page.tsx", "utf8")).toContain("<JourneyCard j={journey.value}");
  });
});
