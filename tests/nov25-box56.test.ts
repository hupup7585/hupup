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
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace(/^.*\/api\/voice\//, "").replace(/&amp;/g, "&");
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
    // Abraham, Nov 25, 2026, 14:09: each amount is before tax (240 + 60 = the rentals before tax); one tax for the order
    expect(24000 + 6000).toBe(o.subtotalCents);
    expect(o.taxCents).toBeGreaterThan(0);
    expect(lines[2].match(/sales tax/g)).toHaveLength(1);
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
  it("pay by card (Nov 24, 2026): the three box 56 lines, then box 140 (on the next step), then the hold line, then the payment line", async () => {
    const { saveSetting } = await import("@/lib/settings");
    await saveSetting("solaPhonePayOn", true);
    await saveSetting("solaPhonePayOwnerOnly", false);
    process.env.SOLA_PHONEPAY_PIN = "4321"; // test calls only: nothing is dialed or charged here
    const id = await cart(["castle", "boat"]);
    const xml = await call("finalize");
    const lines = said(xml);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(`Your order number is ${String(1000 + id).split("").join(" ")}.`);
    expect(lines[1]).toMatch(/^Your total is /);
    expect(lines[2]).toMatch(/^That includes 120 dollars for the jumping balloon, 60 dollars for the paddle boat, /);
    expect(redirect(xml)).toBe(`phonepay-go?o=${id}&n=1`);
    const box140 = await call("phonepay-go", {}, `o=${id}&n=1`);
    expect(said(box140)).toEqual([PROMPTS.pay_card_line.text]);
    const go = await call("phonepay-go", {}, `o=${id}&c=1`);
    expect(said(go)).toEqual([PROMPTS.pay_hold_secure.text]);
    expect(go).toContain("+18334343354</Number>");
    const { allSlots } = await import("@/lib/recording-slots");
    expect(JSON.stringify(PROMPTS) + JSON.stringify(allSlots())).not.toContain("Please hold for a moment");
    expect(allSlots().find((x) => x.key === "pay_hold_secure")?.text).toBe(PROMPTS.pay_hold_secure.text);
  });


});

describe("Box 34 then box 56 (Abraham, Nov 24, 2026, 20:59 and 21:02)", () => {
  it("key 1, a message, pound: the thank-you, the message on the order and in the Delivery instructions box, then box 56 with no pause", async () => {
    const id = await cart(["castle"]);
    const rec = await call("directions-record");
    expect(rec).toContain(`directions-recorded?o=${id}`);
    const done = await call("directions-recorded", { RecordingSid: "REdir1", RecordingUrl: "https://api.twilio.com/rec/REdir1", RecordingDuration: "12" }, `o=${id}`);
    expect(said(done)).toEqual(["Thank you. We have saved your delivery instructions.", "Almost done!"]); // then box 56, no pause (Nov 25, 2026, 12:08)
    expect(done).toMatch(/<Redirect method="POST">[^<]*\/finalize<\/Redirect>/); // box 56 right after (Box 35 is after payment)
    const { deliveryInstructionsFor, deliveryInstructionsBox } = await import("@/lib/voicemail");
    const msgs = await deliveryInstructionsFor(id);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ boxId: (await deliveryInstructionsBox()).id, durationSec: 12, transcriptionStatus: "off" });
    expect(msgs[0].note).toContain(`Order #${1000 + id}`);
    const next = said(await call("finalize"));
    expect(next[0]).toBe(`Your order number is ${String(1000 + id).split("").join(" ")}.`);
  });
  it("hang-up mid-message: what was recorded is still saved on the order", async () => {
    const id = await cart(["slide"]);
    await call("directions-rec-status", { RecordingStatus: "completed", RecordingSid: "REdir2", RecordingUrl: "https://api.twilio.com/rec/REdir2", RecordingDuration: "7" }, `o=${id}`);
    const { deliveryInstructionsFor } = await import("@/lib/voicemail");
    expect((await deliveryInstructionsFor(id))[0]).toMatchObject({ durationSec: 7, ready: true });
  });
  it("pound at the menu: box 35, then pound there: box 56", async () => {
    await cart(["laser"]);
    const skip = await call("directions-choice", { Digits: "#" });
    expect(said(skip)).toEqual(["Almost done!"]); // Nov 25, 2026, 12:08: after Box 34, then box 56
    expect(redirect(skip)).toBe("finalize");
    expect(skip).not.toContain("pause-500ms"); // no pause before box 56
    const { PROMPTS } = await import("@/lib/ivr/prompts");
    expect(PROMPTS.almost_done.text).toBe("Almost done!");
    expect(PROMPTS.box35_receipt.text).toBe("To receive a receipt by email, press 1. To skip, press pound."); // unchanged, no "Almost done!"
  });
});
