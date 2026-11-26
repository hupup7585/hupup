import { beforeAll, describe, expect, it, vi } from "vitest";

/* Abraham, Nov 19 (10:25 PM) and Nov 22, 2026: the new cart, remove an item (box 29b), item removed (box 29a), start over. */
const h = vi.hoisted(() => ({
  session: { callSid: "CAcart22", fromNumber: "+18455550122", orderId: null as number | null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing" },
}));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/session", () => ({
  ensureSession: async () => h.session,
  getSession: async () => h.session,
  updateSession: async (_sid: string, patch: Record<string, unknown> & { data?: Record<string, unknown> }) =>
    Object.assign(h.session, { ...patch, data: { ...h.session.data, ...(patch.data ?? {}) } }),
}));
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));
vi.mock("@/lib/business-hours", async (orig) => ({ ...(await orig<typeof import("@/lib/business-hours")>()), officeOpenNow: () => true, lateHoursToday: () => null }));
vi.mock("@/lib/hours-schedule", async (orig) => ({ ...(await orig<typeof import("@/lib/hours-schedule")>()), lineOpen: () => true })); // each line follows the test's open/closed (Hours page, Nov 25, 2026)
vi.mock("@/lib/notify", () => ({ sendSms: async () => ({ sent: true }), sendEmail: async () => ({ sent: true }), sendMessage: async () => ({ sent: true }) }));

import { handleVoice } from "@/lib/ivr/flow";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";

const call = (action: string, body: Record<string, string> = {}, query = "") =>
  handleVoice({ action, query: new URLSearchParams(query), body: { CallSid: h.session.callSid, ...body }, callSid: h.session.callSid, from: "+18455550122" });
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace("https://hupup.example/api/voice/", "").replace(/&amp;/g, "&");
const said = (xml: string) => [...xml.matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => m[1].replace(/&apos;/g, "'").replace(/&amp;/g, "&"));

const D1 = "2026-12-22";
const D2 = "2026-12-23";
let castle = 0;
let boat = 0;
let cat = 0;

async function hold(eventDate: string, lines: [number, number][]) {
  const [o] = await db.insert(schema.orders).values({ eventDate, pickupDate: eventDate, status: "HOLD", channel: "phone", subtotalCents: 0, holdExpiresAt: new Date(Date.now() + 3_600_000) } as never).returning();
  for (const [productId, qty] of lines) await db.insert(schema.orderItems).values({ orderId: o.id, productId, qty, unitPriceCents: 10000 } as never);
  const { refreshOrderTotals } = await import("@/lib/orders");
  await refreshOrderTotals(o.id);
  return o.id;
}
async function freshCart() {
  const a = await hold(D1, [[castle, 1], [boat, 2]]);
  const b = await hold(D2, [[castle, 1]]);
  h.session.orderId = null;
  h.session.data = { dayOrderIds: [a, b] };
  return [a, b];
}

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  process.env.AUTH_SECRET = "test-secret";
  const [c] = await db.insert(schema.categories).values({ name: "Water Rentals", spokenName: "Water Rentals", ivrDigit: 3, sortOrder: 3, active: true }).returning();
  cat = c.id;
  const [p1] = await db.insert(schema.products).values({ categoryId: c.id, name: "Castle Combo", priceCents: 10000, quantity: 5, active: true, sortOrder: 1 }).returning();
  const [p2] = await db.insert(schema.products).values({ categoryId: c.id, name: "paddle boat", priceCents: 10000, quantity: 5, active: true, sortOrder: 2 }).returning();
  castle = p1.id;
  boat = p2.id;
});

describe("the cart (Nov 19 and 22, 2026)", () => {
  it("each day with digits, singular or plural names, 'and' before the second item; the four keys; only the star line", async () => {
    await freshCart();
    const lines = said(await call("cart"));
    expect(lines[0]).toBe("Here is your cart.");
    expect(lines[1]).toBe("For Tuesday, December twenty-second, 1 Castle Combo, and 2 paddle boats.");
    expect(lines[2]).toBe("For Wednesday, December twenty-third, 1 Castle Combo.");
    expect(lines).toContain("To check out, press 1. To keep shopping, press 2. To remove an item from your cart, press 3. To refresh your cart and start over, press 4.");
    expect(lines.at(-1)).toBe("To go back, press star.");
    expect(lines).not.toContain("To go to your shopping cart, press 0.");
    expect(redirect(await call("cart-choice", { Digits: "3" }))).toBe("remove");
  });

  it("key 3: the count, one line per item, star; one of it goes at once, then the updated cart", async () => {
    const [a] = await freshCart();
    const lines = said(await call("remove"));
    expect(lines).toEqual(["You have in your cart 3 items.", "To remove Castle Combo for Tuesday, December twenty-second, press 1.", "To remove the paddle boat, press 2.", "To remove Castle Combo for Wednesday, December twenty-third, press 3.", "To go back, press star."]);
    expect(redirect(await call("remove-choice", { Digits: "*" }))).toBe("cart");
    const r = await call("remove-choice", { Digits: "1" });
    expect(said(r)).toEqual(["Successfully removed from your cart: 1 Castle Combo for Tuesday, December twenty-second."]);
    expect(redirect(r)).toBe("cart?u=1");
    const items = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, a));
    expect(items.map((i) => i.productId)).toEqual([boat]);
    const upd = said(await call("cart", {}, "u=1"));
    expect(upd[0]).toBe("Here is your updated cart.");
    expect(upd[1]).toBe("For Tuesday, December twenty-second, 2 paddle boats.");
  });

  it("more than one: how many, then that many go; a bad amount asks again", async () => {
    const [a] = await freshCart();
    const [line] = await db.select().from(schema.orderItems).where(eq(schema.orderItems.productId, boat)).orderBy(schema.orderItems.id).limit(1);
    const boatLine = (await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, a))).find((x) => x.productId === boat)!;
    expect(line).toBeTruthy();
    expect(redirect(await call("remove-choice", { Digits: "2" }))).toBe(`remove-qty?i=${boatLine.id}`);
    expect(said(await call("remove-qty", {}, `i=${boatLine.id}`))).toEqual(["You have 2 paddle boats.", "Using your keypad, please enter the amount you would like to remove.", "To go back, press star."]);
    expect(redirect(await call("remove-qty-choice", { Digits: "5" }, `i=${boatLine.id}`))).toBe(`remove-qty?i=${boatLine.id}`);
    const r = await call("remove-qty-choice", { Digits: "1" }, `i=${boatLine.id}`);
    expect(said(r)).toEqual(["Successfully removed from your cart: 1 paddle boat for Tuesday, December twenty-second."]);
    const [after] = await db.select().from(schema.orderItems).where(eq(schema.orderItems.id, boatLine.id));
    expect(after.qty).toBe(1);
  });

  it("the last item removed: the empty cart line, then the bookings menu", async () => {
    const a = await hold(D1, [[castle, 1]]);
    h.session.data = { dayOrderIds: [a] };
    const r = await call("remove-choice", { Digits: "1" });
    expect(said(r)).toEqual(["Successfully removed from your cart: 1 Castle Combo for Tuesday, December twenty-second.", "Your shopping cart is empty right now. Let's start shopping!"]);
    expect(redirect(r)).toBe("book");
    const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, a));
    expect(o.status).not.toBe("HOLD");
  });

  it("key 4: start over (empty cart line, then the bookings menu)", async () => {
    await freshCart();
    const r = await call("cart-choice", { Digits: "4" });
    expect(said(r)).toEqual(["Your shopping cart is empty right now. Let's start shopping!"]);
    expect(redirect(r)).toBe("book");
    expect(cat).toBeGreaterThan(0);
  });

  it("each rental name has a singular and a plural recording slot", async () => {
    const { pluralName, wordSlotsFor } = await import("@/lib/spoken-words");
    expect(pluralName("paddle boat")).toBe("paddle boats");
    expect(pluralName("Bounce Party")).toBe("Bounce Parties");
    expect(pluralName("6 laser guns")).toBe("6 laser guns");
    expect(wordSlotsFor("paddle boats", [{ id: boat, name: "paddle boat" }])).toEqual([`item:${boat}:plural`]);
  });
});
