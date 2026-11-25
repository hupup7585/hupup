import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/* Ocean balls v2 (Abraham, Nov 25, 2026, 14:08-14:12): "To add ocean balls, press 9." once per call after the first
 * jumping balloon; 9 opens the amounts menu; the cart offers it while a balloon is in the cart. */
const h = vi.hoisted(() => ({
  session: { callSid: "CAoc2", fromNumber: "+18455550177", orderId: null as number | null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing", startedAt: new Date() },
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

import { db, schema } from "@/lib/db";
import { handleVoice } from "@/lib/ivr/flow";
import { PROMPTS, RETIRED_PROMPTS } from "@/lib/ivr/prompts";

const call = (action: string, body: Record<string, string> = {}, q = "") =>
  handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: "CAoc2", ...body }, callSid: "CAoc2", from: "+18455550177" });
const said = (xml: string) => [...xml.matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => m[1].replace(/&apos;/g, "'"));
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace(/^.*\/api\/voice\//, "").replace(/&amp;/g, "&");

const OFFER = "To add ocean balls, press 9.";
const MENU = ["To add 200 balls for $10, press 1.", "To add 500 balls for $15, press 2.", "To add 700 balls for $20, press 3.", "To go back, press star."];
let balloon = 0;
let laser = 0;
const DAY = "2026-12-16";

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  const [b] = await db.insert(schema.categories).values({ name: "Jumping Balloons", ivrDigit: 1, sortOrder: 1, active: true }).returning();
  const [l] = await db.insert(schema.categories).values({ name: "Paddle Boats", ivrDigit: 3, sortOrder: 3, active: true }).returning();
  balloon = (await db.insert(schema.products).values({ categoryId: b.id, name: "Soft Hop", priceCents: 10000, quantity: 5, active: true }).returning())[0].id;
  laser = (await db.insert(schema.products).values({ categoryId: l.id, name: "Paddle Boat", priceCents: 6000, quantity: 5, active: true }).returning())[0].id;
});
beforeEach(() => {
  h.session.orderId = null;
  h.session.data = {};
});

describe("the approved lines, word for word, each its own slot; the old ones retired", () => {
  it("texts", () => {
    expect(PROMPTS.ocean_offer.text).toBe(OFFER);
    expect(PROMPTS.cart_ocean.text).toBe(OFFER);
    expect([PROMPTS.ocean_200.text, PROMPTS.ocean_500.text, PROMPTS.ocean_700.text]).toEqual(MENU.slice(0, 3));
    expect(RETIRED_PROMPTS.has("ocean_balls")).toBe(true);
    expect(RETIRED_PROMPTS.has("cart_add_balls")).toBe(true);
  });
});

describe("after the first jumping balloon of the call", () => {
  it("the added line, then the offer; 9 = the amounts menu; not offered after a second balloon", async () => {
    const add = await call("add", {}, `p=${balloon}&d=${DAY}&q=1`);
    expect(redirect(add)).toBe(`added-menu?o=${DAY}`);
    const box25 = said(await call("added-menu", {}, `o=${DAY}`));
    expect(box25[0]).toBe("Successfully added to your cart: 1 Soft Hop for Wednesday, December sixteenth.");
    expect(box25[1]).toBe(OFFER);
    expect(box25.join(" ")).not.toMatch(/Would you like|To skip, press pound/);
    expect(redirect(await call("after-add", { Digits: "9" }, `o=${DAY}`))).toBe(`ocean?d=${DAY}`);
    const menu = said(await call("ocean", {}, `d=${DAY}`));
    expect(menu).toEqual(MENU);
    // second balloon: no offer, and 9 is not a choice there
    const again = await call("add", {}, `p=${balloon}&d=${DAY}&q=1`);
    expect(redirect(again)).toBe("added-menu");
    expect(said(await call("added-menu")).join(" ")).not.toContain(OFFER);
    const nine = await call("after-add", { Digits: "9" });
    expect(said(nine)).toEqual(["Sorry, that is not a valid selection."]);
  });
  it("keys 1-3 add that pack on the balloon's date, then the added line; wrong key: not valid, the same menu; star: back", async () => {
    await call("add", {}, `p=${balloon}&d=${DAY}&q=1`);
    const r = await call("ocean-choice", { Digits: "3" }, `d=${DAY}`);
    expect(said(r)[0]).toMatch(/^Successfully added to your cart: 700 ocean balls for /);
    expect(redirect(r)).toBe("added-menu?n=1");
    const items = await db.select().from(schema.orderItems).where((await import("drizzle-orm")).eq(schema.orderItems.orderId, h.session.orderId!));
    expect(items).toHaveLength(2);
    const bad = await call("ocean-choice", { Digits: "7" }, `d=${DAY}`);
    expect(said(bad)).toEqual(["Sorry, that is not a valid selection."]);
    expect(redirect(bad)).toBe(`ocean?d=${DAY}`);
    expect(redirect(await call("ocean-choice", { Digits: "*" }, `d=${DAY}`))).toBe(`added-menu?o=${DAY}`);
    expect(redirect(await call("ocean", {}, `d=${DAY}`))).toMatch(/^idle\?to=ocean/); // the no-key rule
  });
});

describe("the cart", () => {
  it("a balloon in the cart: the line plays (also after balls were added); 9 = the menu, then back to the cart", async () => {
    await call("add", {}, `p=${balloon}&d=${DAY}&q=1`);
    expect(said(await call("cart"))).toContain(OFFER);
    expect(redirect(await call("cart-choice", { Digits: "9" }))).toBe(`ocean?d=${DAY}&n=cart`);
    expect(redirect(await call("ocean-choice", { Digits: "1" }, `d=${DAY}&n=cart`))).toBe("cart");
    expect(said(await call("cart"))).toContain(OFFER); // still offered after balls were added
    expect(redirect(await call("ocean-choice", { Digits: "*" }, `d=${DAY}&n=cart`))).toBe("cart");
  });
  it("no balloon in the cart: no line, and 9 is a wrong key", async () => {
    await call("add", {}, `p=${laser}&d=${DAY}&q=1`);
    expect(said(await call("cart"))).not.toContain(OFFER);
    const nine = await call("cart-choice", { Digits: "9" });
    expect(said(nine)).toEqual(["Sorry, that is not a valid selection."]);
    expect(redirect(nine)).toBe("cart");
  });
});
