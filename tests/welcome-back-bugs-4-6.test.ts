import { beforeAll, describe, expect, it, vi } from "vitest";

/* Hark's phone bug check (Nov 26, 2026): bug 4 (welcome back drops the other old items once a key is pressed) and
   bug 6 (welcome back loses the closed-day pickup and the 1.5 days). In-memory database. */
const h = vi.hoisted(() => ({ session: { callSid: "CAwb46", fromNumber: "+18455550466", orderId: null as number | null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing" } }));
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
import { eq, inArray } from "drizzle-orm";
import { handleVoice } from "@/lib/ivr/flow";
const call = (action: string, body: Record<string, string> = {}, query = "") =>
  handleVoice({ action, query: new URLSearchParams(query), body: { CallSid: "CAwb46", ...body }, callSid: "CAwb46", from: "+18455550466" });
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace("https://hupup.example/api/voice/", "").replace(/&amp;/g, "&");

let ids: number[] = [];
beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  delete process.env.VERCEL_ENV;
  const [c] = await db.insert(schema.categories).values({ name: "Laser Tag", sortOrder: 2, active: true }).returning();
  const ps = await db
    .insert(schema.products)
    .values([
      { categoryId: c.id, name: "Garbage maze", priceCents: 30000, quantity: 1, active: true },
      { categoryId: c.id, name: "Only 6 laser guns", priceCents: 11000, quantity: 2, active: true },
      { categoryId: c.id, name: "Paddle boat", priceCents: 9000, quantity: 3, active: true },
    ])
    .returning();
  ids = ps.map((p) => p.id);
  await db.insert(schema.callSessions).values({ callSid: "CAwbold", fromNumber: "+18455550466", startedAt: new Date(Date.now() - 86_400_000) });
  // Last call: three items for Friday, Jan 15, 2027, booked through box 17 (kept until Sunday, 1.5 days)
  const [o] = await db.insert(schema.orders).values({ status: "CANCELLED", channel: "PHONE", eventDate: "2027-01-15", pickupDate: "2027-01-17", spanDays: 1.5, callSid: "CAwbold" }).returning();
  await db.insert(schema.orderItems).values(ps.map((p) => ({ orderId: o.id, productId: p.id, qty: 1, unitPriceCents: p.priceCents })));
  await db.update(schema.callSessions).set({ data: { cartLeft: [o.id] } }).where(eq(schema.callSessions.callSid, "CAwbold"));
});

describe("welcome back", () => {
  it("bug 6: each resumed line keeps the pickup day and the 1.5 days; bug 4: keep shopping after the first item leaves no old item behind", async () => {
    expect(redirect(await call("resume-choice", { Digits: "1" }))).toBe("resume-items");
    const lines = h.session.data.resumeLines as { state: string; holdId: number }[];
    expect(lines.map((l) => l.state)).toEqual(["free", "free", "free"]);
    const holds = await db.select().from(schema.orders).where(inArray(schema.orders.id, lines.map((l) => l.holdId)));
    for (const o of holds) expect([o.pickupDate, o.spanDays]).toEqual(["2027-01-17", 1.5]);
    expect((h.session.data.spanDays as Record<string, unknown>)["2027-01-15"]).toEqual({ after: "2027-01-17", days: 1.5 });
    // the first item goes in, then the caller presses 1 (keep shopping)
    expect(redirect(await call("resume-items"))).toMatch(/^resume-added\?d=2027-01-15/);
    expect(redirect(await call("resume-added-choice", { Digits: "1" }, "d=2027-01-15"))).toBe("cats");
    const after = h.session.data.resumeLines as { state: string }[];
    expect(after.map((l) => l.state)).toEqual(["added", "added", "added"]);
    const cart = await db.select().from(schema.orders).where(inArray(schema.orders.id, h.session.data.dayOrderIds as number[]));
    expect(cart).toHaveLength(1);
    expect([cart[0].pickupDate, cart[0].spanDays, cart[0].status]).toEqual(["2027-01-17", 1.5, "HOLD"]);
    const items = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, cart[0].id));
    expect(items.map((i) => i.productId).sort()).toEqual([...ids].sort());
  });
});
