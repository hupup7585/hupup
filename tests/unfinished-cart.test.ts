import { beforeEach, describe, expect, it, vi } from "vitest";

/* Unfinished phone orders (Abraham, Nov 15, 2026): a caller back from the same number, after pressing 1 for bookings,
   hears last call's cart; free items go back in the cart, taken ones get the nearest options. */

const h = vi.hoisted(() => ({ session: { callSid: "CAnew", fromNumber: "+18455550277", orderId: null as number | null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing" } }));
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
import { handleVoice } from "@/lib/ivr/flow";
const call = (action: string, body: Record<string, string> = {}, query = "") =>
  handleVoice({ action, query: new URLSearchParams(query), body: { CallSid: "CAnew", ...body }, callSid: "CAnew", from: "+18455550277" });
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace("https://hupup.example/api/voice/", "").replace(/&amp;/g, "&");
const said = (xml: string) => [...xml.matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => m[1].replace(/&apos;/g, "'"));

let castle: number, laser: number;
beforeEach(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  delete process.env.VERCEL_ENV;
  h.session.data = {};
  h.session.orderId = null;
  if (!castle) {
    const [c] = await db.insert(schema.categories).values({ name: "Bounce", sortOrder: 1, active: true }).returning();
    const [a, b] = await db
      .insert(schema.products)
      .values([
        { categoryId: c.id, name: "Castle", priceCents: 20000, quantity: 1, sizeOrder: 2, active: true },
        { categoryId: c.id, name: "Laser tag set", priceCents: 30000, quantity: 1, active: true },
      ])
      .returning();
    castle = a.id;
    laser = b.id;
    // Last call, from the same number: Castle and Laser tag on Dec 22, hung up before checkout (hold released)
    await db.insert(schema.callSessions).values({ callSid: "CAold", fromNumber: "+18455550277", startedAt: new Date(Date.now() - 3_600_000) });
    const [o] = await db.insert(schema.orders).values({ status: "CANCELLED", channel: "PHONE", eventDate: "2026-12-22", pickupDate: "2026-12-23", callSid: "CAold" }).returning();
    await db.insert(schema.orderItems).values([
      { orderId: o.id, productId: castle, qty: 1, unitPriceCents: 20000 },
      { orderId: o.id, productId: laser, qty: 1, unitPriceCents: 30000 },
    ]);
    // Since then someone else booked the Castle for Dec 22
    const [m] = await db.insert(schema.orders).values({ status: "CONFIRMED", channel: "PHONE", eventDate: "2026-12-22", pickupDate: "2026-12-23" }).returning();
    await db.insert(schema.orderItems).values({ orderId: m.id, productId: castle, qty: 1, unitPriceCents: 20000 });
  }
});

describe("unfinished phone order", () => {
  it("key 1: offered once; press 1 puts free items back and gives the taken one its nearest options", async () => {
    expect(redirect(await call("book"))).toBe("resume");
    const offer = await call("resume");
    expect(said(offer).join(" ")).toContain("Welcome back! On your last call you had one Castle and one Laser tag set for Tuesday, December 22 in your cart. To check if it is still available and continue, press 1. To start a new order, press 2.");
    const back = await call("resume-choice", { Digits: "1" });
    expect(said(back).join(" ")).toContain("back in your cart: one Laser tag set");
    expect(redirect(back)).toBe("cart");
    // the cart first plays the Castle's nearest options (the same as when an item is booked)
    expect(redirect(await call("cart"))).toBe(`booked?p=${castle}&d=2026-12-22`);
    // asked once only
    expect(redirect(await call("book"))).not.toBe("resume");
    void laser;
  });
  it("press 2 starts a new order", async () => {
    h.session.data = { resumeAsked: undefined };
    expect(redirect(await call("resume-choice", { Digits: "2" }))).toBe("book");
  });
  it("live line: waits until Abraham approves its two lines", async () => {
    process.env.VERCEL_ENV = "production";
    expect(redirect(await call("book"))).not.toBe("resume");
  });
});
