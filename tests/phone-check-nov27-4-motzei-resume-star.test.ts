/* Hark's phone check (Nov 27, 2026): a simulated call for bug 4 (docs/audit; the proof call, now asserting the right behaviour). */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", async () => { const { createMemoryDb } = await import("./helpers/memory-db"); const m = await createMemoryDb(); return { db: m.db, schema: m.schema }; });
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));
vi.mock("@/lib/notify", () => ({ sendSms: async () => ({ sent: true }), sendEmail: async () => ({ sent: true }) }));
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { handleCallStatus, handleVoice } from "@/lib/ivr/flow";
import { redirect, said, gatherAction } from "./helpers/phone-check-common";
const PINNED = process.env.HUP_CALENDAR_NOW;
afterAll(() => void (process.env.HUP_CALENDAR_NOW = PINNED));
let n = 0;
async function callFrom(from: string) {
  const sid = `CAsh${++n}`;
  const first = await handleVoice({ action: "incoming", query: new URLSearchParams(), body: { CallSid: sid, From: from }, callSid: sid, from });
  const step = (action: string, body: Record<string, string> = {}, q = "") => handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: sid, From: from, ...body }, callSid: sid, from });
  return { sid, step, first };
}
let p = 0, cat = 0;
const DAY = "2027-01-18";
beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  process.env.VERCEL_ENV = "production";
  const [c] = await db.insert(schema.categories).values({ name: "Paddle Boats", ivrDigit: 3, sortOrder: 3, active: true }).returning();
  cat = c.id;
  p = (await db.insert(schema.products).values({ categoryId: c.id, name: "paddle boat", priceCents: 10000, quantity: 1, active: true }).returning())[0].id;
});
const log = (k: string, x: string) => console.log(k.padEnd(34), "|", said(x).join(" / ").slice(0, 230), "| ->", redirect(x) ?? gatherAction(x), x.includes("<Hangup/>") ? "HANGUP" : "", x.includes("<Record") ? "RECORD" : "");
describe("Shabbes cut-off mid-call, then Motzei Shabbes", () => {
  it("walk", async () => {
    process.env.HUP_CALENDAR_NOW = "2027-01-15T19:00:00Z"; // Friday 2 PM
    const from = "+18455550444";
    const a = await callFrom(from);
    log("incoming (Fri 2 PM)", a.first);
    log("add", await a.step("add", {}, `p=${p}&d=${DAY}&q=1`));
    process.env.HUP_CALENDAR_NOW = "2027-01-15T21:25:00Z"; // Friday 4:25 PM: inside the 15 minutes
    const x = await a.step("cart-choice", { Digits: "1" });
    log("cart-choice 1 (Fri 4:25 PM)", x);
    await handleCallStatus(a.sid, "completed");
    const [o] = await db.select().from(schema.orders).where(eq(schema.orders.callSid, a.sid));
    console.log("saved order", o.status, o.holdExpiresAt?.toISOString());
    // Motzei Shabbes after reopening
    process.env.HUP_CALENDAR_NOW = "2027-01-16T23:30:00Z"; // Sat 6:30 PM
    const b = await callFrom(from);
    log("incoming (Sat 6:30 PM)", b.first);
    log("menu-choice 1", await b.step("menu-choice", { Digits: "1" }));
    log("book", await b.step("book"));
    log("resume", await b.step("resume"));
    log("resume-choice * (main menu)", await b.step("resume-choice", { Digits: "*" }));
    log("menu-choice 1", await b.step("menu-choice", { Digits: "1" }));
    const again = await b.step("book");
    log("book", again);
    expect(redirect(again)).toBe("resume"); // star decided nothing: welcome back is offered again
    log("resume", await b.step("resume"));
    const one = await b.step("resume-choice", { Digits: "1" });
    log("resume-choice 1", one);
    expect(redirect(one)).toBe("resume-items"); // the saved items come back into this call's cart
    const all = await db.select().from(schema.orders);
    for (const r of all) console.log("order", r.id, r.callSid, r.status, r.holdExpiresAt?.toISOString());
  });
});
