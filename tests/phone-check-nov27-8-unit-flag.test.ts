/* Hark's phone check (Nov 27, 2026): a simulated call for bug 8 (docs/audit; the proof call, now asserting the right behaviour). */
import { beforeAll, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  session: { callSid: "CAx", fromNumber: "+18455550302", orderId: null as number | null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing", startedAt: new Date() },
}));
vi.mock("@/lib/db", async () => { const { createMemoryDb } = await import("./helpers/memory-db"); const m = await createMemoryDb(); return { db: m.db, schema: m.schema }; });
vi.mock("@/lib/ivr/session", () => ({
  ensureSession: async () => h.session, getSession: async () => h.session,
  updateSession: async (_s: string, patch: Record<string, unknown> & { data?: Record<string, unknown> }) => Object.assign(h.session, { ...patch, data: { ...h.session.data, ...(patch.data ?? {}) } }),
}));
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));
vi.mock("@/lib/notify", () => ({ sendSms: async () => ({ sent: true }), sendEmail: async () => ({ sent: true }) }));
vi.mock("@/lib/delivery-areas", async (orig) => ({ ...(await orig<typeof import("@/lib/delivery-areas")>()), deliveryQuote: async () => ({ ok: true, zone: "Monroe", feeCents: 2500 }) }));
vi.mock("@/lib/business-hours", async (orig) => ({ ...(await orig<typeof import("@/lib/business-hours")>()), officeOpenNow: () => true, lateHoursToday: () => null }));
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { handleVoice } from "@/lib/ivr/flow";
import { redirect, said, gatherAction } from "./helpers/phone-check-common";
const call = (action: string, body: Record<string, string> = {}, q = "") => handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: "CAx", ...body }, callSid: "CAx", from: "+18455550302" });
const resetSession = () => Object.assign(h.session, { orderId: null, data: {}, outcome: "browsing", startedAt: new Date() });

import { reserveItem } from "@/lib/orders";
let bal = 0, balls = 0;
const D = "2026-12-08";
beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  process.env.VERCEL_ENV = "production";
  await db.insert(schema.directoryEntries).values([{ lastName: "Klein", house: "12", street: "Forest Road", unit: null, town: "Monroe", zip: "10950" }]);
  const [c] = await db.insert(schema.categories).values({ name: "Jumping Balloons", ivrDigit: 1, sortOrder: 1, active: true }).returning();
  bal = (await db.insert(schema.products).values({ categoryId: c.id, name: "Soft Hop", priceCents: 16500, quantity: 2, active: true }).returning())[0].id;
});
describe("unit flag from an earlier pass", () => {
  it("star back to the street after answering 'no unit' on an unknown address, then the right (directory one-family) street: order still flagged Unit not verified", async () => {
    resetSession();
    const r = await reserveItem({ orderId: null, productId: bal, qty: 1, eventDate: D, channel: "PHONE", status: "HOLD", callSid: "CAx", holdExpiresAt: new Date(Date.now() + 15 * 60_000) });
    if (!r.ok) throw new Error("hold");
    h.session.orderId = r.orderId; h.session.data = { dayOrderIds: [r.orderId], name: "Sara Klein", house: "12", zip: "10950", heard: "Forest Lane" };
    const log = (k: string, x: string) => console.log(k.padEnd(36), "|", said(x).join(" / ").slice(0, 150), "| ->", redirect(x) ?? gatherAction(x));
    log("addr-street-rb-choice 1 (Forest Lane)", await call("addr-street-rb-choice", { Digits: "1" }, "m=k"));
    log("addr-unit-ask (not in directory)", await call("addr-unit-ask"));
    log("addr-unit-ask-choice 2 (no unit)", await call("addr-unit-ask-choice", { Digits: "2" }));
    log("addr-check", await call("addr-check"));
    log("addr-readback-choice * (wrong street)", await call("addr-readback-choice", { Digits: "*" }));
    h.session.data.heard = "Forest Road";
    log("addr-street-rb-choice 1 (Forest Road)", await call("addr-street-rb-choice", { Digits: "1" }, "m=k"));
    log("addr-unit-ask (directory: one family)", await call("addr-unit-ask"));
    log("addr-check", await call("addr-check"));
    log("addr-readback-choice 1", await call("addr-readback-choice", { Digits: "1" }));
    log("finalize", await call("finalize"));
    const { eq } = await import("drizzle-orm");
    const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, r.orderId));
    console.log("order", o.status, o.deliveryAddress, "unitNotVerified =", o.unitNotVerified);
    expect(o.unitNotVerified).toBe(false);
  });
});
