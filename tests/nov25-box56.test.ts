import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/* Box 56 (Abraham, Nov 24, 2026, 21:02): order number, total, the breakdown by rental type, the hold line. */
const h = vi.hoisted(() => ({
  session: { callSid: "CAb56", fromNumber: "+18455550401", orderId: null as number | null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "carted", startedAt: new Date() },
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
vi.mock("@/lib/delivery-areas", async (orig) => ({ ...(await orig<typeof import("@/lib/delivery-areas")>()), deliveryQuote: async () => ({ ok: true, zone: "Local", feeCents: 3000 }) }));

import { db, schema } from "@/lib/db";
import { handleVoice } from "@/lib/ivr/flow";
import { PROMPTS } from "@/lib/ivr/prompts";
import { box56Groups, rentalKind, typeClip, TYPE_CLIPS } from "@/lib/box56";
import { reserveItem } from "@/lib/orders";

const call = (action: string, body: Record<string, string> = {}, q = "") =>
  handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: "CAb56", ...body }, callSid: "CAb56", from: "+18455550401" });
const said = (xml: string) => [...xml.matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => m[1].replace(/&apos;/g, "'"));
const P: Record<string, number> = {};
let day = 10;

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  const cat = async (name: string, digit: number) => (await db.insert(schema.categories).values({ name, ivrDigit: digit, sortOrder: digit, active: true }).returning())[0].id;
  const balloons = await cat("Jumping Balloons", 1);
  const laser = await cat("Laser Tag and Inflatable Mazes", 2);
  const paddle = await cat("Paddle Boats", 3);
  const prod = async (key: string, categoryId: number, name: string, priceCents: number) => (P[key] = (await db.insert(schema.products).values({ categoryId, name, priceCents, quantity: 5, active: true }).returning())[0].id);
  await prod("castle", balloons, "Castle Bouncer", 12000);
  await prod("slide", balloons, "Mega Slide", 12000);
  await prod("laser", laser, "Laser Tag Arena", 30000);
  await prod("boat", paddle, "Paddle Boat", 6000);
  await prod("package", paddle, "Paddle Boat with Pool", 9000);
});
beforeEach(() => {
  h.session.orderId = null;
  h.session.data = { name: "Sara Klein", address: "12 Forest Road, Monroe, NY 10950", house: "12", street: "Forest Road", zip: "10950", town: "Monroe", phone: "+18455550401", smsConsent: "no", termsAccepted: true };
});

async function cart(keys: string[]) {
  const date = `2026-12-${String(day++).padStart(2, "0")}`;
  let orderId: number | null = null;
  for (const k of keys) {
    const r = await reserveItem({ orderId, productId: P[k], qty: 1, eventDate: date, channel: "PHONE", status: "HOLD", callSid: "CAb56" });
    if (!r.ok) throw new Error(`no hold for ${k}`);
    orderId = r.orderId;
  }
  h.session.orderId = orderId;
  return orderId!;
}

describe("the approved lines and the eight type clips", () => {
  it("word for word", () => {
    expect(PROMPTS.checkout_order_number.text).toBe("Your order number is {number}.");
    expect(PROMPTS.checkout_total.text).toBe("Your total is {total}.");
    expect(PROMPTS.checkout_includes.text).toBe("That includes {amount} {type}, {delivery} for delivery, and {tax} sales tax.");
    expect(Object.values(TYPE_CLIPS).flatMap((t) => [t.one, t.more])).toEqual(["for the jumping balloon", "for the jumping balloons", "for the laser tag set", "for the laser tag sets", "for the paddle boat", "for the paddle boats", "for the paddle boat package", "for the paddle boat packages"]);
  });
  it("an Admin slot for each piece and each type clip", async () => {
    const { allSlots } = await import("@/lib/recording-slots");
    const slots = new Map(allSlots().map((s) => [s.key, s.text]));
    expect(slots.get("checkout_order_number#1")).toBe("Your order number is");
    expect(slots.get("checkout_total#1")).toBe("Your total is");
    expect(slots.get("checkout_includes#1")).toBe("That includes");
    expect(slots.get("checkout_includes#2")).toBe("for delivery, and");
    expect(slots.get("checkout_includes#3")).toBe("sales tax.");
    expect(slots.get("type:jumping_balloons")).toBe("for the jumping balloons");
    expect(slots.get("type:paddle_boat_package")).toBe("for the paddle boat package");
  });
  it("no 'for the rentals' anywhere", async () => {
    const { readFileSync } = await import("node:fs");
    expect(JSON.stringify(PROMPTS)).not.toContain("for the rentals");
    expect(readFileSync("src/lib/ivr/flow.ts", "utf8")).not.toContain("for the rentals");
  });
});

describe("rental kind from today's Catalog data (no new field)", () => {
  it("category names; the package is its own item in the paddle category", () => {
    expect(rentalKind("Jumping Balloons", "Castle").kind).toBe("jumping_balloon");
    expect(rentalKind("Laser Tag and Inflatable Mazes", "Arena").kind).toBe("laser_tag_set");
    expect(rentalKind("Paddle Boats", "Paddle Boat").kind).toBe("paddle_boat");
    expect(rentalKind("Paddle Boats", "Paddle Boat with Pool").kind).toBe("paddle_boat_package");
    expect(rentalKind("Paddle Boats", "Paddle Boat Package").kind).toBe("paddle_boat_package");
  });
  it("subtotals always add up to the order subtotal; plural only for more than one", () => {
    const g = box56Groups([{ subtotalCents: 30000, lines: [{ categoryName: "Jumping Balloons", productName: "A", qty: 1, cents: 12000 }, { categoryName: "Jumping Balloons", productName: "B", qty: 1, cents: 12000 }, { categoryName: "Paddle Boats", productName: "Paddle Boat", qty: 1, cents: 6000 }] }]);
    expect(g.map((x) => [x.kind, x.cents, typeClip(x)])).toEqual([["jumping_balloon", 24000, "for the jumping balloons"], ["paddle_boat", 6000, "for the paddle boat"]]);
  });
});

describe("box 56 on a call", () => {
  it("2 jumping balloons and 1 paddle boat: order number, total, breakdown, hold line; amounts equal the order in Admin", async () => {
    const id = await cart(["castle", "slide", "boat"]);
    const xml = await call("finalize");
    const lines = said(xml);
    const [o] = await db.select().from(schema.orders).where((await import("drizzle-orm")).eq(schema.orders.id, id));
    const digits = String(1000 + id).split("").join(" ");
    const money = (c: number) => `${Math.floor(c / 100)} dollars${c % 100 ? ` and ${c % 100} cents` : ""}`;
    expect(lines.slice(0, 3)).toEqual([
      `Your order number is ${digits}.`,
      `Your total is ${money(o.totalCents!)}.`,
      `That includes 240 dollars for the jumping balloons, 60 dollars for the paddle boat, ${money(o.deliveryFeeCents)} for delivery, and ${money(o.taxCents)} sales tax.`,
    ]);
    expect(o.subtotalCents + o.deliveryFeeCents + o.taxCents).toBe(o.totalCents);
    expect(lines.join(" ")).not.toMatch(/You are all set|Sara/);
  });
  it("1 laser tag set: singular", async () => {
    await cart(["laser"]);
    expect(said(await call("finalize"))[2]).toMatch(/^That includes 300 dollars for the laser tag set, /);
  });
  it("the package item: for the paddle boat package; a plain boat keeps for the paddle boat", async () => {
    await cart(["package", "boat"]);
    expect(said(await call("finalize"))[2]).toMatch(/^That includes 90 dollars for the paddle boat package, 60 dollars for the paddle boat, /);
  });
  it("the hold line plays right before the secure payment line", async () => {
    const { readFileSync } = await import("node:fs");
    const f = readFileSync("src/lib/ivr/flow.ts", "utf8");
    expect(f).toMatch(/sp\(vr, ctx, "phonepay_intro", undefined, \{ draftOk: true \}\); \/\/ box 56's last line[^\n]*\n\s*return back\(vr, "phonepay-go"/);
    expect(PROMPTS.phonepay_intro.text).toBe("Thank you. Please hold for a moment while we connect you to our secure payment line.");
  });
});
