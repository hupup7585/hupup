import { beforeAll, describe, expect, it, vi } from "vitest";

/* Welcome back (Abraham, Nov 23, 2026): only when the caller's LAST call ended with at least one item still in the
   cart. Four calls: item left in the cart, cart cleared, item removed, paid order. Real call sessions (in memory). */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));
vi.mock("@/lib/notify", () => ({ sendSms: async () => ({ sent: true }), sendEmail: async () => ({ sent: true }) }));

import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { handleCallStatus, handleVoice } from "@/lib/ivr/flow";

const said = (xml: string) => [...xml.matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => m[1].replace(/&apos;/g, "'"));
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace(/^.*\/api\/voice\//, "").replace(/&amp;/g, "&");
const DAY = "2026-12-29";
let p = 0;
let n = 0;

async function callFrom(from: string) {
  const sid = `CAwb${++n}`;
  await handleVoice({ action: "incoming", query: new URLSearchParams(), body: { CallSid: sid, From: from }, callSid: sid, from });
  const step = (action: string, body: Record<string, string> = {}, q = "") => handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: sid, From: from, ...body }, callSid: sid, from });
  return { sid, step };
}

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  const [c] = await db.insert(schema.categories).values({ name: "Paddle Boats", sortOrder: 3, active: true }).returning();
  const [x] = await db.insert(schema.products).values({ categoryId: c.id, name: "paddle boat", priceCents: 10000, quantity: 5, active: true }).returning();
  p = x.id;
});

async function nextCallHearsWelcomeBack(from: string) {
  const next = await callFrom(from);
  const r = redirect(await next.step("book"));
  return r === "resume";
}

describe("welcome back plays only after a call that ended with an item in the cart", () => {
  it("1. item left in the cart, then hung up: welcome back plays (once per call)", async () => {
    const from = "+18455550301";
    const a = await callFrom(from);
    await a.step("add", {}, `p=${p}&d=${DAY}&q=1`);
    await handleCallStatus(a.sid, "completed");
    const next = await callFrom(from);
    expect(redirect(await next.step("book"))).toBe("resume");
    expect(said(await next.step("resume")).join(" ")).toMatch(/^Welcome back!/);
    expect(redirect(await next.step("book"))).not.toBe("resume"); // at most once per call
  });
  it("2. cart cleared (key 4), then hung up: no welcome back", async () => {
    const from = "+18455550302";
    const a = await callFrom(from);
    await a.step("add", {}, `p=${p}&d=${DAY}&q=1`);
    await a.step("cart-choice", { Digits: "4" });
    await handleCallStatus(a.sid, "completed");
    expect(await nextCallHearsWelcomeBack(from)).toBe(false);
  });
  it("3. the item removed (key 3), then hung up: no welcome back", async () => {
    const from = "+18455550303";
    const a = await callFrom(from);
    await a.step("add", {}, `p=${p}&d=${DAY}&q=1`);
    await a.step("remove-choice", { Digits: "1" });
    await handleCallStatus(a.sid, "completed");
    expect(await nextCallHearsWelcomeBack(from)).toBe(false);
  });
  it("4. paid order: no welcome back", async () => {
    const from = "+18455550304";
    const a = await callFrom(from);
    await a.step("add", {}, `p=${p}&d=${DAY}&q=1`);
    const [o] = await db.select().from(schema.orders).where(eq(schema.orders.callSid, a.sid));
    await db.update(schema.orders).set({ status: "CONFIRMED", paidCents: 10000 }).where(eq(schema.orders.id, o.id));
    await handleCallStatus(a.sid, "completed");
    expect(await nextCallHearsWelcomeBack(from)).toBe(false);
  });
  it("an older call with a cart does not count when the last call ended empty; past dates never count", async () => {
    const from = "+18455550305";
    const a = await callFrom(from);
    await a.step("add", {}, `p=${p}&d=${DAY}&q=1`);
    await handleCallStatus(a.sid, "completed");
    const b = await callFrom(from); // nothing added
    await handleCallStatus(b.sid, "completed");
    expect(await nextCallHearsWelcomeBack(from)).toBe(false);
  });
});
