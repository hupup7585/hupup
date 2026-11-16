import { beforeAll, describe, expect, it, vi } from "vitest";

/* Phone line (Abraham, Nov 17, 2026): ocean balls on the order and total; lists of 10 or more items. No real calls. */
const h = vi.hoisted(() => ({
  session: { callSid: "CAn17p", fromNumber: "+18455550188", orderId: null as number | null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing", startedAt: new Date() },
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
vi.mock("@/lib/notify", () => ({ sendSms: async () => ({ sent: true }), sendEmail: async () => ({ sent: true }) }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { handleVoice } from "@/lib/ivr/flow";

const call = (action: string, body: Record<string, string> = {}, q = "") =>
  handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: "CAn17p", ...body }, callSid: "CAn17p", from: "+18455550188" });
const said = (xml: string) => [...xml.matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => m[1].replace(/&apos;/g, "'"));
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace(/^.*\/api\/voice\//, "").replace(/&amp;/g, "&");

let catId = 0;
const ids: number[] = [];
const DAY = "2026-12-15";

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  const [cat] = await db.insert(schema.categories).values({ name: "Jumping Balloons", spokenName: "jumping balloons", ivrDigit: 1, sortOrder: 1, active: true }).returning();
  catId = cat.id;
  for (let i = 1; i <= 12; i++) {
    const [p] = await db.insert(schema.products).values({ categoryId: cat.id, name: `Balloon ${i}`, priceCents: 10000, quantity: 2, sortOrder: i, active: true }).returning();
    ids.push(p.id);
  }
});

describe("a jumping balloons list with 12 items", () => {
  it("reads every item, up to press 12; two keys pick 10 to 12, a single key waits briefly", async () => {
    const xml = await call("category", {}, `c=${catId}`);
    const lines = said(xml);
    expect(lines).toContain("For the Balloon 9, press 9.");
    expect(lines).toContain("For the Balloon 10, press 10.");
    expect(lines).toContain("For the Balloon 12, press 12.");
    expect(xml).toMatch(/<Gather [^>]*numDigits="2"[^>]*timeout="2"/);
    expect(redirect(await call("category-choice", { Digits: "12" }, `c=${catId}`))).toBe(`date?p=${ids[11]}`);
    expect(redirect(await call("category-choice", { Digits: "10" }, `c=${catId}`))).toBe(`date?p=${ids[9]}`);
    expect(redirect(await call("category-choice", { Digits: "1" }, `c=${catId}`))).toBe(`date?p=${ids[0]}`);
    expect(redirect(await call("category-choice", { Digits: "13" }, `c=${catId}`))).toBe(`category?c=${catId}`); // no item 13
    expect(redirect(await call("category-choice", { Digits: "0" }, `c=${catId}`))).toBe(`cart?c=${catId}`);
  });
});

describe("ocean balls after a jumping balloon", () => {
  it("2 adds 500 balls for $15 to the same day's order, so it's in the payment total", async () => {
    const add = await call("add", {}, `p=${ids[0]}&d=${DAY}&q=1`);
    expect(said(add)).toContain("This item is successfully added to your cart.");
    expect(redirect(add)).toBe(`ocean?d=${DAY}`);
    const r = await call("ocean-choice", { Digits: "2" }, `d=${DAY}`);
    expect(redirect(r)).toBe("added-menu");
    const order = h.session.orderId!;
    const items = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, order));
    const balls = await db.select().from(schema.products).where(eq(schema.products.name, "500 ocean balls"));
    expect(items.map((i) => i.productId)).toContain(balls[0].id);
    const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, order));
    expect(o.subtotalCents).toBe(10000 + 1500);
  });
  it("any other key: the shared wrong-key line, then the same question", async () => {
    const r = await call("ocean-choice", { Digits: "7" }, `d=${DAY}`);
    expect(said(r)).toEqual(["Sorry, that is not a valid selection. Please try again."]);
    expect(redirect(r)).toBe(`ocean?d=${DAY}`);
  });
  it("the ocean balls are hidden: not in the phone menus (their group has no key and is off)", async () => {
    const [c] = await db.select().from(schema.categories).where(eq(schema.categories.name, "Ocean balls"));
    expect(c.active).toBe(false);
    expect(c.ivrDigit).toBeNull();
  });
});
