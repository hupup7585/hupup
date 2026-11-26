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
  it("the time ran out (caller stopped responding): the disconnect line, then the call hangs up; no timed-out line, no main menu", async () => {
    expect(await releaseExpired()).toBeGreaterThan(0);
    expect((await holdOf(orderId)).status).not.toBe("HOLD");
    for (const step of ["finalize", "terms-answer", "ask"]) {
      const x = await call(step, {}, step === "ask" ? "f=name" : "");
      expect(said(x), step).toEqual(["It sounds like we got disconnected, but you can call us back at any time. Thank you for calling Hup Up Attractions. Bye for now!"]); // the disconnect line only, then the hang-up (Abraham, Nov 26, 2026, 12:27 ET)
      expect(x, step).toContain("<Hangup/>");
      expect(x, step).not.toContain("/menu");
      expect(x, step).not.toMatch(/timed out/i);
    }
  });
});
