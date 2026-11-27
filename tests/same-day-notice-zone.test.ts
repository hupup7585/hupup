import { afterAll, describe, expect, it, vi } from "vitest";

/* Same-day delivery notice by zone (Abraham, Nov 27, 2026, 12:33 AM): right after the address is saved, when a day in
   the cart is today: close by (Kiryas Joel) 2.5 to 3.5 hours, surrounding areas 3.5 to 4.5 hours (Admin). */
const h = vi.hoisted(() => ({ kind: "local" as "local" | "area", session: { callSid: "CAzone", fromNumber: "+18455550818", orderId: null as number | null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing" } }));
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
// the draft notice approved for this test, so it plays
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({ same_day_notice: { approvedAt: new Date() } }) }));
vi.mock("@/lib/delivery-areas", async (orig) => ({ ...(await orig<typeof import("@/lib/delivery-areas")>()), deliveryQuote: async () => ({ ok: true, zone: h.kind === "local" ? "Kiryas Joel" : "Monroe", feeCents: 2000, kind: h.kind }) }));

import { db, schema } from "@/lib/db";
import { handleVoice } from "@/lib/ivr/flow";
import { todayISO, addDays } from "@/lib/dates";
const PINNED = process.env.HUP_CALENDAR_NOW; // the test setup's pinned day, put back after each test
afterAll(() => void (process.env.HUP_CALENDAR_NOW = PINNED));

const call = (action: string) => handleVoice({ action, query: new URLSearchParams(), body: { CallSid: "CAzone" }, callSid: "CAzone", from: "+18455550818" });
const said = (xml: string) => [...xml.matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => m[1]).join(" ");

async function cartFor(date: string) {
  const [c] = await db.insert(schema.categories).values({ name: `Cat ${Math.random()}`, sortOrder: 1, active: true }).returning();
  const [p] = await db.insert(schema.products).values({ categoryId: c.id, name: "Castle", priceCents: 20000, quantity: 3, active: true }).returning();
  const [o] = await db.insert(schema.orders).values({ status: "HOLD", channel: "PHONE", eventDate: date, pickupDate: addDays(date, 1), holdExpiresAt: new Date(Date.now() + 600_000) }).returning();
  await db.insert(schema.orderItems).values({ orderId: o.id, productId: p.id, qty: 1, unitPriceCents: 20000 });
  h.session.data = { dayOrderIds: [o.id], address: "1 Forest Rd, Monroe, NY 10950", town: "Monroe" };
}

describe("same-day notice after the address", () => {
  it("close by: two and a half to three and a half hours; surrounding: three and a half to four and a half", async () => {
    process.env.PUBLIC_BASE_URL = "https://hupup.example";
    process.env.HUP_CALENDAR_NOW = new Date().toISOString(); // the test setup pins another day; today is real here
    await cartFor(todayISO());
    h.kind = "local";
    const x1 = await call("addr-price");
    expect(said(x1)).toContain("about two and a half to three and a half hours");
    h.kind = "area";
    expect(said(await call("addr-price"))).toContain("about three and a half to four and a half hours");
  });
  it("no notice when no day in the cart is today", async () => {
    await cartFor(addDays(todayISO(), 5));
    expect(said(await call("addr-price"))).not.toContain("same-day");
  });
});
