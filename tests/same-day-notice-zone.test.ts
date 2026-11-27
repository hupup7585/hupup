import { afterAll, describe, expect, it, vi } from "vitest";

/* Same-day delivery notice (Abraham, Nov 27, 2026, 12:47 AM): right after the address is saved, when a day in the cart
   is today: one notice with both ranges; the after-hours version when customer service (key 4) is closed. */
const h = vi.hoisted(() => ({ open: true, kind: "local" as "local" | "area", session: { callSid: "CAzone", fromNumber: "+18455550818", orderId: null as number | null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing" } }));
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
vi.mock("@/lib/hours-schedule", async (orig) => ({ ...(await orig<typeof import("@/lib/hours-schedule")>()), lineOpen: () => h.open, effectiveLine: () => ({ on: true, schedule: {} }) }));
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
  // (Admin still keeps the ranges and the close-by areas for the website and records)
  it("customer service open: the open version; closed: the after-hours version", async () => {
    process.env.PUBLIC_BASE_URL = "https://hupup.example";
    process.env.HUP_CALENDAR_NOW = new Date().toISOString(); // the test setup pins another day; today is real here
    await cartFor(todayISO());
    h.open = true;
    const x1 = await call("addr-price");
    expect(said(x1)).toContain("please call our customer service after the order was placed");
    h.open = false;
    expect(said(await call("addr-price"))).toContain("please leave a message for customer service after the order was placed");
  });
  it("no notice when no day in the cart is today", async () => {
    await cartFor(addDays(todayISO(), 5));
    expect(said(await call("addr-price"))).not.toContain("same-day");
  });
});
