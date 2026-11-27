/* Hark's phone check (Nov 27, 2026): a simulated call for bug 6 (docs/audit; the proof call, now asserting the right behaviour). */
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

let bal = 0;
const D = "2026-12-08";
beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  process.env.VERCEL_ENV = "production";
  const [c] = await db.insert(schema.categories).values({ name: "Jumping Balloons", ivrDigit: 1, sortOrder: 1, active: true }).returning();
  bal = (await db.insert(schema.products).values({ categoryId: c.id, name: "Soft Hop", priceCents: 16500, quantity: 2, active: true }).returning())[0].id;
  const [o] = await db.insert(schema.categories).values({ name: "Ocean balls", sortOrder: 9, active: true }).returning();
  await db.insert(schema.products).values([{ categoryId: o.id, name: "200 ocean balls", priceCents: 1000, quantity: 20, active: true, sortOrder: 1 }, { categoryId: o.id, name: "500 ocean balls", priceCents: 1500, quantity: 20, active: true, sortOrder: 2 }]);
});
describe("ocean balls left alone in the cart after the balloon is removed", () => {
  it("walk", async () => {
    resetSession();
    const log = (k: string, x: string) => console.log(k.padEnd(30), "|", said(x).join(" / ").slice(0, 220), "| ->", redirect(x) ?? gatherAction(x));
    log("add Soft Hop", await call("add", {}, `p=${bal}&d=${D}&q=1`));
    log("after-add 9 (ocean)", await call("after-add", { Digits: "9" }, `o=${D}`));
    log("ocean-choice 2 (500 balls)", await call("ocean-choice", { Digits: "2" }, `d=${D}`));
    log("remove", await call("remove"));
    log("remove-choice 1 (Soft Hop)", await call("remove-choice", { Digits: "1" }));
    const cart = await call("cart", {}, "u=1");
    log("cart", cart);
    // the same pack twice (from the cart, key 9 is gone without a balloon; add the balloon back and take balls again)
    log("add Soft Hop again", await call("add", {}, `p=${bal}&d=${D}&q=1`));
    log("cart-choice 9", await call("cart-choice", { Digits: "9" }));
    log("ocean-choice 2 (cart)", await call("ocean-choice", { Digits: "2" }, `d=${D}&n=cart`));
    const c2 = await call("cart");
    log("cart", c2);
    log("remove", await call("remove"));
    log("remove-choice 2 (balls)", await call("remove-choice", { Digits: "2" }));
    const rq = await call("remove-qty-choice", { Digits: "1" }, new URL("https://x/" + (redirect(await call("remove-choice", { Digits: "2" })) ?? "")).searchParams.toString());
    log("remove-qty-choice 1", rq);
    expect(said(cart).join(" ")).not.toMatch(/, 1 500 ocean balls/);
  });
});
