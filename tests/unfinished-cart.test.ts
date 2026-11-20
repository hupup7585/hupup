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
    const [lt] = await db.insert(schema.categories).values({ name: "Laser Tag", sortOrder: 2, active: true }).returning();
    const [a, b] = await db
      .insert(schema.products)
      .values([
        { categoryId: c.id, name: "Castle", priceCents: 20000, quantity: 1, sizeOrder: 2, active: true },
        { categoryId: lt.id, name: "Laser tag set", priceCents: 30000, quantity: 1, active: true },
      ])
      .returning();
    castle = a.id;
    laser = b.id;
    // Last call, from the same number: Castle and Laser tag on Dec 22, hung up before checkout (hold released)
    await db.insert(schema.callSessions).values({ callSid: "CAold", fromNumber: "+18455550277", startedAt: new Date(Date.now() - 3 * 86_400_000) }); // 3 days ago: still offered (until the booking day passes)
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
  it("key 1: offered once; press 1 checks again: free items straight into the cart (box 11), taken ones get box 11a", async () => {
    const { callOrdersFor } = { callOrdersFor: null };
    void callOrdersFor;
    expect(redirect(await call("book"))).toBe("resume");
    const offer = await call("resume");
    expect(said(offer).join(" ")).toContain("Welcome back! On your last call you had in your cart one Castle and one Laser tag set for Tuesday, December twenty-second. To check if they are still available, press 1. To start a new order, press 2.");
    expect(redirect(await call("resume-choice", { Digits: "1" }))).toBe("resume-items");
    // nothing in the cart yet
    expect(h.session.data.dayOrderIds ?? []).toEqual([]);
    const lines = h.session.data.resumeLines as { state: string; holdId: number | null }[];
    expect(lines.map((l) => l.state)).toEqual(["taken", "free"]); // Castle taken, Laser tag free (and held)
    const held = (await db.select().from(schema.orders)).find((o) => o.id === lines[1].holdId)!;
    expect(held.status).toBe("HOLD");
    // Box 8, press 1 (Abraham, Nov 18, 2026; boxes 9 and 10 deleted): the free Laser tag set goes straight into the cart
    // Nov 19, 2026 (Part 8): the old-cart added line with its own keys; laser tag: no ocean balls
    const added = await call("resume-items");
    expect((h.session.data.dayOrderIds as number[]).length).toBe(1);
    expect(redirect(added)).toBe("resume-added?d=2026-12-22");
    const menu = await call("resume-added", {}, "d=2026-12-22");
    expect(said(menu)).toEqual(["This item was successfully added to your cart. To go to your shopping cart, press 0. To keep shopping, for same day, press 1. For another day, press 2.", "To go back, press star."]);
    expect(redirect(menu)).toBe("resume-items"); // no key: the next old item
    expect(redirect(await call("resume-added-choice", { Digits: "0" }))).toBe("cart");
    expect(redirect(await call("resume-added-choice", { Digits: "1" }))).toBe("book");
    expect(redirect(await call("resume-added-choice", { Digits: "2" }))).toBe("date");
    expect(redirect(await call("resume-added-choice", { Digits: "7" }, "d=2026-12-22"))).toBe("resume-added?d=2026-12-22");
    // then the taken Castle: box 11a, same date or nearest date
    expect(redirect(await call("resume-items"))).toBe(`booked-near?p=${castle}&d=2026-12-22`);
    // then the cart
    expect(redirect(await call("resume-items"))).toBe("cart");
    // asked once only
    const again = await call("book");
    expect(redirect(again)).not.toBe("resume");
    // back to add more items: no orders-only line (Abraham, Nov 19, 2026: its own recording, first time only)
    expect(said(again)[0]).toBe("To receive our catalog by text or email, press 8.");
    expect(said(again).join(" ")).not.toContain("Please note");
    void laser;
  });
  it("one item free: straight into the cart, then the cart for checkout (no box 9)", async () => {
    const [hold] = await db.insert(schema.orders).values({ status: "HOLD", channel: "PHONE", eventDate: "2026-12-29", pickupDate: "2026-12-30", holdExpiresAt: new Date(Date.now() + 600_000), callSid: "CAnew" }).returning();
    await db.insert(schema.orderItems).values({ orderId: hold.id, productId: laser, qty: 1, unitPriceCents: 30000 });
    h.session.data = { resumeAsked: 1, resumeLines: [{ p: laser, name: "Laser tag set", qty: 1, d: "2026-12-29", holdId: hold.id, state: "free" }] };
    const r = await call("resume-items");
    expect(redirect(r)).toBe("resume-added?d=2026-12-29");
    expect(h.session.data.dayOrderIds).toEqual([hold.id]);
    expect(redirect(await call("resume-items"))).toBe("cart");
  });
  it("a jumping balloon added back: the ocean balls question first, then the old-cart added line, then the next item", async () => {
    const [hold] = await db.insert(schema.orders).values({ status: "HOLD", channel: "PHONE", eventDate: "2027-01-05", pickupDate: "2027-01-06", holdExpiresAt: new Date(Date.now() + 600_000), callSid: "CAnew" }).returning();
    await db.insert(schema.orderItems).values({ orderId: hold.id, productId: castle, qty: 1, unitPriceCents: 20000 });
    h.session.data = { resumeAsked: 1, resumeLines: [{ p: castle, name: "Castle", qty: 1, d: "2027-01-05", holdId: hold.id, state: "free" }, { p: laser, name: "Laser tag set", qty: 1, d: "2027-01-05", holdId: null, state: "taken" }] };
    const r = await call("resume-items");
    expect(said(r)).toEqual([]);
    expect(redirect(r)).toBe("ocean?d=2027-01-05&n=resume");
    expect(redirect(await call("ocean-choice", { Digits: "#" }, "d=2027-01-05&n=resume"))).toBe("resume-added?d=2027-01-05");
  });
  it("press 2 starts a new order", async () => {
    h.session.data = { resumeAsked: undefined };
    expect(redirect(await call("resume-choice", { Digits: "2" }))).toBe("book");
  });
  it("not offered once the caller booked on a later call, or after the booking day", async () => {
    h.session.data = {};
    await db.insert(schema.callSessions).values({ callSid: "CAlater", fromNumber: "+18455550277", startedAt: new Date(Date.now() - 86_400_000) });
    const [o] = await db.insert(schema.orders).values({ status: "CONFIRMED", channel: "PHONE", eventDate: "2026-12-30", pickupDate: "2026-12-31", callSid: "CAlater" }).returning();
    await db.insert(schema.orderItems).values({ orderId: o.id, productId: laser, qty: 1, unitPriceCents: 30000 });
    expect(redirect(await call("book"))).not.toBe("resume");
  });
  it("live line: waits until Abraham approves its two lines", async () => {
    process.env.VERCEL_ENV = "production";
    expect(redirect(await call("book"))).not.toBe("resume");
  });
});
