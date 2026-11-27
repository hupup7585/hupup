import { beforeAll, describe, expect, it, vi } from "vitest";

/* Box 30, the cart hold (Abraham, Nov 24, 2026). In-memory database. */
const h = vi.hoisted(() => ({
  session: { callSid: "CAhold", fromNumber: "+18455550199", orderId: null as number | null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing", startedAt: new Date() },
}));
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

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { handleVoice } from "@/lib/ivr/flow";
import { releaseExpired } from "@/lib/orders";

const call = (action: string, body: Record<string, string> = {}, q = "") =>
  handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: "CAhold", ...body }, callSid: "CAhold", from: "+18455550199" });
const said = (xml: string) => [...xml.matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => m[1]);
const holdOf = async (id: number) => (await db.select().from(schema.orders).where(eq(schema.orders.id, id)))[0];
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
let orderId = 0;

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  const { reserveItem } = await import("@/lib/orders");
  const [c] = await db.insert(schema.categories).values({ name: "Jumping Balloons", ivrDigit: 1, sortOrder: 1, active: true }).returning();
  const [p] = await db.insert(schema.products).values({ categoryId: c.id, name: "Soft Hop", priceCents: 6500, quantity: 3, active: true }).returning();
  const r = await reserveItem({ orderId: null, productId: p.id, qty: 1, eventDate: "2026-12-07", channel: "PHONE", status: "HOLD" });
  if (!r.ok) throw new Error("no hold");
  orderId = r.orderId;
  h.session.orderId = orderId;
});

describe("box 30: the cart hold", () => {
  it("each key press extends the hold, even when its time just passed", async () => {
    await db.update(schema.orders).set({ holdExpiresAt: minutesAgo(1) }).where(eq(schema.orders.id, orderId));
    await call("book-choice", { Digits: "5" });
    const o = await holdOf(orderId);
    expect(o.status).toBe("HOLD");
    expect(o.holdExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
  });
  it("a step with no key does not bring back a hold whose time passed", async () => {
    await db.update(schema.orders).set({ holdExpiresAt: minutesAgo(1) }).where(eq(schema.orders.id, orderId));
    await call("book");
    expect((await holdOf(orderId)).holdExpiresAt!.getTime()).toBeLessThan(Date.now());
  });
  /* Box 30 (Abraham, Nov 26, 2026, 13:11 ET): the hold ran out on a caller who stopped responding */
  const CHECK = "It sounds like we got disconnected. To keep the items in your cart, press any key to continue.";
  const RELEASED = ["The items in your cart will now be released. You can call us back at any time.", "Thank you for calling Hup Up Attractions", "Bye for now!"];
  it("the time ran out: the hold check with a 3-second wait; nothing is released yet; no timed-out line, no main menu", async () => {
    expect(await releaseExpired()).toBeGreaterThan(0); // the hourly tidy-up released the ended hold
    for (const step of ["finalize", "terms-answer", "ask"]) {
      const x = await call(step, {}, step === "ask" ? "f=name" : "");
      expect(said(x), step).toEqual([CHECK]);
      expect(x, step).toMatch(/<Gather [^>]*timeout="3"[^>]*action="[^"]*cart-hold-key/);
      expect(x, step).toContain("/api/voice/cart-hold-release</Redirect>");
      expect(x, step).not.toContain("<Hangup/>");
      expect(x, step).not.toMatch(/timed out|\/menu/i);
    }
  });
  it("any key within the wait: the items are held again and the caller is back on the exact step", async () => {
    const x = await call("ask", {}, "f=name");
    const action = x.match(/action="([^"]+)"/)![1].replace(/&amp;/g, "&");
    const back = await call("cart-hold-key", { Digits: "4" }, new URL(action).searchParams.toString());
    expect(back).toMatch(/<Redirect method="POST">[^<]*\/api\/voice\/ask\?f=name<\/Redirect>/);
    const o = await holdOf(orderId);
    expect(o.status).toBe("HOLD");
    expect(o.holdExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
  });
  it("no key: the items are released, then the three pieces in order, and the call ends", async () => {
    expect((await holdOf(orderId)).status).toBe("HOLD"); // released only on no key
    const x = await call("cart-hold-release");
    expect(said(x)).toEqual(RELEASED);
    expect(x.trim().endsWith("<Hangup/></Response>")).toBe(true);
    expect((await holdOf(orderId)).status).toBe("CANCELLED");
  });
  it("an item booked by someone else meanwhile: it comes out of the cart and the caller hears the usual item-taken screen", async () => {
    const [mine] = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, orderId));
    await db.update(schema.orders).set({ status: "HOLD", holdExpiresAt: minutesAgo(1) }).where(eq(schema.orders.id, orderId));
    const [other] = await db.insert(schema.orders).values({ status: "CONFIRMED", channel: "PHONE", eventDate: "2026-12-07", pickupDate: "2026-12-08" }).returning();
    await db.insert(schema.orderItems).values({ orderId: other.id, productId: mine.productId, qty: 3, unitPriceCents: 6500 });
    const back = await call("cart-hold-key", { Digits: "1" }, "to=ask&q=f%3Dname");
    expect(back).toMatch(new RegExp(`/api/voice/booked\\?p=${mine.productId}&amp;d=2026-12-07`));
    expect(await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, orderId))).toHaveLength(0);
    await db.delete(schema.orderItems).where(eq(schema.orderItems.orderId, other.id));
    await db.insert(schema.orderItems).values({ orderId, productId: mine.productId, qty: 1, unitPriceCents: 6500 });
  });
  it("deep check 06:00 M53: two items sharing one unit (the maze group) are not both held again when only one is free", async () => {
    const [c] = await db.insert(schema.categories).values({ name: "Mazes M53", ivrDigit: 7, sortOrder: 7, active: true }).returning();
    const [a, b] = await db
      .insert(schema.products)
      .values([
        { categoryId: c.id, name: "Maze A", priceCents: 30000, quantity: 1, stockGroup: "maze53", active: true },
        { categoryId: c.id, name: "Maze B", priceCents: 30000, quantity: 1, stockGroup: "maze53", active: true },
      ])
      .returning();
    const [cart] = await db.insert(schema.orders).values({ status: "HOLD", channel: "PHONE", eventDate: "2026-12-14", pickupDate: "2026-12-15", holdExpiresAt: minutesAgo(1) }).returning();
    await db.insert(schema.orderItems).values([
      { orderId: cart.id, productId: a.id, qty: 1, unitPriceCents: 30000 },
      { orderId: cart.id, productId: b.id, qty: 1, unitPriceCents: 30000 },
    ]);
    const before = h.session.orderId;
    h.session.orderId = cart.id;
    await call("cart-hold-key", { Digits: "1" }, "to=ask&q=f%3Dname");
    h.session.orderId = before;
    expect(await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, cart.id))).toHaveLength(1);
    expect((await holdOf(cart.id)).status).toBe("HOLD");
  });
  it("the wait comes from Admin (Phone timing)", async () => {
    const { saveSetting } = await import("@/lib/settings");
    await db.update(schema.orders).set({ status: "HOLD", holdExpiresAt: minutesAgo(1) }).where(eq(schema.orders.id, orderId));
    await releaseExpired();
    await saveSetting("timerCartHoldCheck" as never, "6" as never, null);
    expect(await call("ask", {}, "f=name")).toMatch(/<Gather [^>]*timeout="6"/);
    await saveSetting("timerCartHoldCheck" as never, "3" as never, null);
  });
  it("goodbye rule (Abraham, 12:46 ET): before payment 'Thank you for calling', after payment Line 7 'Thank you for choosing'", async () => {
    const { PROMPTS } = await import("@/lib/ivr/prompts");
    for (const k of ["no_input_final", "goodbye_thanks_calling", "catalog_bye", "catalog_texted", "pay_link_sent"] as const) {
      expect(PROMPTS[k].text, k).toContain("Thank you for calling Hup Up Attractions");
      expect(PROMPTS[k].text, k).not.toContain("Thank you for choosing");
    }
    expect(PROMPTS.disconnect_goodbye.text).toContain("Thank you for choosing Hup Up Attractions");
  });
});
