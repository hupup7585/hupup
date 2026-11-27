/* Hark's phone check (Nov 27, 2026): a simulated call for bug 3 (docs/audit; the proof call, now asserting the right behaviour). */
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
vi.mock("@/lib/business-hours", async (orig) => ({ ...(await orig<typeof import("@/lib/business-hours")>()), officeOpenNow: () => true, lateHoursToday: () => null }));
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { handleVoice } from "@/lib/ivr/flow";
import { redirect, said, gatherAction } from "./helpers/phone-check-common";
const call = (action: string, body: Record<string, string> = {}, q = "") => handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: "CAx", ...body }, callSid: "CAx", from: "+18455550302" });
const resetSession = () => Object.assign(h.session, { orderId: null, data: {}, outcome: "browsing", startedAt: new Date() });

let cat = 0, a = 0, b = 0;
const D1 = "2026-12-08", D2 = "2026-12-15";
beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  process.env.VERCEL_ENV = "production";
  const [c] = await db.insert(schema.categories).values({ name: "Mazes", ivrDigit: 1, sortOrder: 1, active: true }).returning();
  cat = c.id;
  a = (await db.insert(schema.products).values({ categoryId: c.id, name: "Big Maze", priceCents: 30000, quantity: 3, active: true, sortOrder: 1 }).returning())[0].id;
  b = (await db.insert(schema.products).values({ categoryId: c.id, name: "Small Maze", priceCents: 20000, quantity: 3, active: true, sortOrder: 2 }).returning())[0].id;
});
describe("the last item of a day removed: that day stays the 'current day'", () => {
  it("walk", async () => {
    resetSession();
    const log = (k: string, x: string) => console.log(k.padEnd(34), "|", said(x).join(" / ").slice(0, 160), "| ->", redirect(x) ?? gatherAction(x));
    log("category-choice 1 (Big Maze)", await call("category-choice", { Digits: "1" }, `c=${cat}`));
    log("date-ask (box 18) key 1", await call("box18-choice", { Digits: "1" }, `p=${a}&d=${D1}`));
    log("add", await call("add", {}, `p=${a}&d=${D1}&q=1`));
    log("after-add 2 (another day)", await call("after-add", { Digits: "2" }));
    log("date-confirm 1 (D2)", await call("date-confirm", { Digits: "1" }, `d=${D2}&a=1`));
    log("category-choice 2 (Small Maze)", await call("category-choice", { Digits: "2" }, `c=${cat}`));
    log("add", await call("add", {}, `p=${b}&d=${D2}&q=1`));
    log("cart", await call("cart"));
    log("cart-choice 3 (remove)", await call("cart-choice", { Digits: "3" }));
    log("remove", await call("remove"));
    log("remove-choice 2 (Small Maze, D2)", await call("remove-choice", { Digits: "2" }));
    log("cart u=1", await call("cart", {}, "u=1"));
    log("cart-choice 2 (keep shopping)", await call("cart-choice", { Digits: "2" }));
    log("cats-choice 1", await call("cats-choice", { Digits: "1" }));
    const pick = await call("category-choice", { Digits: "2" }, `c=${cat}`);
    log("category-choice 2 (Small Maze)", pick);
    console.log("session day:", h.session.data.day, " days in cart:", (await db.select({ d: schema.orders.eventDate, s: schema.orders.status }).from(schema.orders)).map((o) => `${o.d}:${o.s}`));
    expect(redirect(pick)).toBe(`date?p=${b}`); // the date is asked; never the removed day silently
  });
});
