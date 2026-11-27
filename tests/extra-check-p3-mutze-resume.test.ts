import { beforeAll, describe, expect, it, vi } from "vitest";

/* Extra check P3 (Nov 27, 2026): welcome back keeps a Chanukah Friday kept for Mutze Shabbes (picked up Sunday), so an
   item added for that Friday goes on the same order, not on a second Friday-only one. In-memory database. */
const h = vi.hoisted(() => ({ session: { callSid: "CAp3", fromNumber: "+18455550633", orderId: null as number | null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing" } }));
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

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { saveSetting, getSettings } from "@/lib/settings";
import { friMutzeOffered, friMutzePickup } from "@/lib/holiday-rentals";
import { handleVoice } from "@/lib/ivr/flow";

const call = (action: string, body: Record<string, string> = {}, query = "") =>
  handleVoice({ action, query: new URLSearchParams(query), body: { CallSid: "CAp3", ...body }, callSid: "CAp3", from: "+18455550633" });
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace("https://hupup.example/api/voice/", "").replace(/&amp;/g, "&");

const FRIDAY = "2026-12-11"; // a Chanukah Friday
let balloon = 0;
let slide = 0;

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  delete process.env.VERCEL_ENV;
  await saveSetting("holidayPerDayChanukah" as never, true as never);
  const [c] = await db.insert(schema.categories).values({ name: "Jumping Balloons", sortOrder: 1, active: true, ivrDigit: 1 }).returning();
  [{ id: balloon }, { id: slide }] = await db
    .insert(schema.products)
    .values([
      { categoryId: c.id, name: "Castle", priceCents: 12000, quantity: 2, active: true },
      { categoryId: c.id, name: "Slide", priceCents: 15000, quantity: 2, active: true },
    ])
    .returning();
  await db.insert(schema.callSessions).values({ callSid: "CAp3old", fromNumber: "+18455550633", startedAt: new Date(Date.now() - 86_400_000) });
  // last call: the Castle for the Chanukah Friday, kept for Mutze Shabbes (picked up Sunday)
  const [o] = await db.insert(schema.orders).values({ status: "CANCELLED", channel: "PHONE", eventDate: FRIDAY, pickupDate: friMutzePickup(FRIDAY), callSid: "CAp3old" }).returning();
  await db.insert(schema.orderItems).values({ orderId: o.id, productId: balloon, qty: 1, unitPriceCents: 12000 });
  await db.update(schema.callSessions).set({ data: { cartLeft: [o.id] } }).where(eq(schema.callSessions.callSid, "CAp3old"));
});

describe("extra check P3: welcome back with a Friday kept for Mutze Shabbes", () => {
  it("the Friday stays kept for Mutze Shabbes; a second item for that Friday goes on the same order (Sunday pickup)", async () => {
    expect(friMutzeOffered(FRIDAY, (await getSettings()) as never)).toBe(true);
    expect(redirect(await call("resume-choice", { Digits: "1" }))).toBe("resume-items");
    expect(h.session.data.mutzeDays).toEqual([FRIDAY]);
    await call("resume-items");
    // keep shopping the same day: another item for that Friday
    await call("resume-added-choice", { Digits: "1" }, `d=${FRIDAY}`);
    await call("add", {}, `p=${slide}&d=${FRIDAY}`);
    const ids = (h.session.data.dayOrderIds as number[]) ?? [];
    const days = (await db.select().from(schema.orders)).filter((o) => ids.includes(o.id));
    expect(days).toHaveLength(1);
    expect(days[0].pickupDate).toBe(friMutzePickup(FRIDAY));
    const items = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, days[0].id));
    expect(items.map((i) => i.productId).sort()).toEqual([balloon, slide].sort());
  });
  it("a plain Friday (not Chanukah or Chol Hamoed) is never marked Mutze Shabbes", async () => {
    expect(friMutzeOffered("2027-01-15", (await getSettings()) as never)).toBe(false);
  });
});
