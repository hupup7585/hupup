import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/* Deep check Nov 27, 9:00 AM, P1 (M10 completed), simulated call: the caller's try 1 could not be checked (it was
   charged), try 2 is charged too. Back on our line (phonepay-done) the caller goes to the after-payment lines (paid
   once, try 1's charge voided), never box 147 again and again with a new charge each time. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));
vi.mock("@/lib/notify", () => ({ sendSms: async () => ({ sent: true }), sendEmail: async () => ({ sent: true }) }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { handleVoice } from "@/lib/ivr/flow";
import { reserveItem } from "@/lib/orders";

const eastern = (d: Date) => d.toLocaleString("sv-SE", { timeZone: "America/New_York" });
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace(/^.*\/api\/voice\//, "").replace(/&amp;/g, "&");
let pid = 0;
beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  process.env.SOLA_API_KEY = "test";
  const [c] = await db.insert(schema.categories).values({ name: "Jumping Balloons", ivrDigit: 1, sortOrder: 1, active: true }).returning();
  pid = (await db.insert(schema.products).values({ categoryId: c.id, name: "Soft Hop", priceCents: 16500, quantity: 2, active: true }).returning())[0].id;
});
afterEach(() => vi.unstubAllGlobals());

function sola(charges: { ref: string; cents: number; at: Date }[]) {
  const voided: string[] = [];
  vi.stubGlobal("fetch", (async (_u: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { xCommand?: string; xRefNum?: string };
    if (body.xCommand === "cc:void") {
      voided.push(String(body.xRefNum));
      return new Response(JSON.stringify({ xResult: "A" }));
    }
    return new Response(JSON.stringify({ xResult: "S", xReportData: charges.filter((c) => !voided.includes(c.ref)).map((c) => ({ xRefNum: c.ref, xAmount: (c.cents / 100).toFixed(2), xEnteredDate: eastern(c.at) })) }));
  }) as unknown as typeof fetch);
  return voided;
}

async function payingCaller(sid: string, date: string, cents: number) {
  const r = await reserveItem({ orderId: null, productId: pid, qty: 1, eventDate: date, channel: "PHONE", status: "PENDING_PAYMENT", holdExpiresAt: new Date(Date.now() + 600_000), callSid: sid });
  if (!r.ok) throw new Error("no hold");
  await db.update(schema.orders).set({ totalCents: cents }).where(eq(schema.orders.id, r.orderId));
  return r.orderId;
}
const call = (sid: string, action: string, q: string) => handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: sid, DialCallStatus: "completed" }, callSid: sid, from: "+18455550193" });

describe("deep check 09:00 P1, simulated call", () => {
  it("try 2 after an unchecked charged try 1: after-payment lines, paid once, try 1's charge voided", async () => {
    const sid = "CAp1call1";
    const o = await payingCaller(sid, "2027-04-06", 17841);
    const now = Date.now();
    await db.insert(schema.phonepayAttempts).values({ orderId: o, callSid: sid, tryNumber: 1, amountCents: 17841, startedAt: new Date(now - 5 * 60_000), result: "check_failed" });
    const [a2] = await db.insert(schema.phonepayAttempts).values({ orderId: o, callSid: sid, tryNumber: 2, amountCents: 17841, startedAt: new Date(now - 60_000) }).returning();
    const voided = sola([
      { ref: "C1-1", cents: 17841, at: new Date(now - 4 * 60_000) },
      { ref: "C1-2", cents: 17841, at: new Date(now - 20_000) },
    ]);
    expect(redirect(await call(sid, "phonepay-done", `o=${o}&a=${a2.id}`))).toBe(`pay-approved?o=${o}`);
    const [row] = await db.select().from(schema.orders).where(eq(schema.orders.id, o));
    expect(row.paidCents).toBe(17841);
    expect(row.status).toBe("CONFIRMED");
    expect(voided).toEqual(["C1-1"]);
  });

  it("try 3 after an unclear try 2: after-payment lines; both earlier charges voided", async () => {
    const sid = "CAp1call2";
    const o = await payingCaller(sid, "2027-04-13", 17941);
    const now = Date.now();
    await db.insert(schema.phonepayAttempts).values({ orderId: o, callSid: sid, tryNumber: 1, amountCents: 17941, startedAt: new Date(now - 9 * 60_000), result: "check_failed" });
    await db.insert(schema.phonepayAttempts).values({ orderId: o, callSid: sid, tryNumber: 2, amountCents: 17941, startedAt: new Date(now - 5 * 60_000), result: "unclear", unclearRefs: "C2-1,C2-2" });
    const [a3] = await db.insert(schema.phonepayAttempts).values({ orderId: o, callSid: sid, tryNumber: 3, amountCents: 17941, startedAt: new Date(now - 60_000) }).returning();
    const voided = sola([
      { ref: "C2-1", cents: 17941, at: new Date(now - 8 * 60_000) },
      { ref: "C2-2", cents: 17941, at: new Date(now - 4 * 60_000) },
      { ref: "C2-3", cents: 17941, at: new Date(now - 20_000) },
    ]);
    expect(redirect(await call(sid, "phonepay-done", `o=${o}&a=${a3.id}`))).toBe(`pay-approved?o=${o}`);
    const [row] = await db.select().from(schema.orders).where(eq(schema.orders.id, o));
    expect(row.paidCents).toBe(17941);
    expect([...voided].sort()).toEqual(["C2-1", "C2-2"]);
  });

  it("Sola still cannot be checked: box 147 (try again), nothing marked paid", async () => {
    const sid = "CAp1call3";
    const o = await payingCaller(sid, "2027-04-20", 18041);
    const [a1] = await db.insert(schema.phonepayAttempts).values({ orderId: o, callSid: sid, tryNumber: 1, amountCents: 18041, startedAt: new Date(Date.now() - 60_000) }).returning();
    vi.stubGlobal("fetch", (async () => new Response(JSON.stringify({ xResult: "E", xError: "down" }))) as unknown as typeof fetch);
    const r = redirect(await call(sid, "phonepay-done", `o=${o}&a=${a1.id}`));
    expect(r).toContain("phonepay-retry");
    expect(r).toContain("u=1");
    const [row] = await db.select().from(schema.orders).where(eq(schema.orders.id, o));
    expect(row.paidCents).toBe(0);
  }, 30_000);
});
