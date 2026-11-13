import { describe, expect, it, vi } from "vitest";

/* The payment link rule (Abraham, Nov 13, 2026): hold while active, 4 idle minutes ends it, 10 minutes on the card
   page, then "Check availability again" re-holds the same order only if everything is still free. */

vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { LINK_TEXT, LINK_WORDING_APPROVED, holdAgain, holdEnded, holdForCardPage, keepHoldWhileActive, linkRulesActive } from "@/lib/late-payment";

const MIN = 60_000;
const t0 = new Date("2026-12-01T15:00:00Z");
const at = (m: number) => new Date(t0.getTime() + m * MIN);

async function setup(qty = 1) {
  const [c] = await db.insert(schema.categories).values({ name: `Cat ${Math.random()}`, sortOrder: 1 }).returning();
  const [p] = await db.insert(schema.products).values({ categoryId: c.id, name: "Castle", priceCents: 20000, quantity: qty }).returning();
  const mk = async (holdMin: number, channel: "PHONE" | "POS" = "PHONE", real = false) => {
    const end = real ? new Date(Date.now() + holdMin * MIN) : at(holdMin);
    const [o] = await db.insert(schema.orders).values({ status: "PENDING_PAYMENT", channel, eventDate: "2026-12-20", pickupDate: "2026-12-21", holdExpiresAt: end }).returning();
    await db.insert(schema.orderItems).values({ orderId: o.id, productId: p.id, qty: 1, unitPriceCents: 20000 });
    return o.id;
  };
  return { mk };
}
const get = async (id: number) => (await db.select().from(schema.orders).where(eq(schema.orders.id, id)))[0];

describe("payment link rule", () => {
  it("live: Abraham approved every line of the link page (Nov 13, 2026)", () => {
    expect(LINK_WORDING_APPROVED).toBe(true);
    expect(linkRulesActive({ VERCEL_ENV: "production" })).toBe(true);
    expect(linkRulesActive({ VERCEL_ENV: "preview" })).toBe(true);
  });
  it("the nearest-options list is live: Abraham approved its intro line", async () => {
    const { OPTIONS_WORDING_APPROVED, linkOptionsActive, LINK_TEXT: T } = await import("@/lib/late-payment");
    expect(OPTIONS_WORDING_APPROVED).toBe(true);
    expect(T.optionsIntro).toBe("Here are the nearest options that are free for you right now. Tap one to hold it for you:");
    expect(linkOptionsActive({ VERCEL_ENV: "production" })).toBe(true);
    expect(linkOptionsActive({ VERCEL_ENV: "preview" })).toBe(true);
  });
  it("opened at minute 9 and nothing more: ends at minute 13; Agree and pay: 10 minutes for the card", async () => {
    const { mk } = await setup();
    const id = await mk(10);
    await keepHoldWhileActive([id], at(9));
    expect((await get(id)).holdExpiresAt!.getTime()).toBe(at(13).getTime());
    expect(holdEnded(await get(id), at(12.9))).toBe(false);
    expect(holdEnded(await get(id), at(13))).toBe(true);
    await holdForCardPage([id], at(11));
    expect((await get(id)).holdExpiresAt!.getTime()).toBe(at(21).getTime());
  });
  it("activity never brings back a hold that already ended", async () => {
    const { mk } = await setup();
    const id = await mk(10);
    await keepHoldWhileActive([id], at(11));
    await holdForCardPage([id], at(11));
    expect((await get(id)).holdExpiresAt!.getTime()).toBe(at(10).getTime());
  });
  it("Check availability again: held again when still free (10 minutes phone, 25 Admin); refused when someone else has it", async () => {
    const { mk } = await setup(1);
    const phone = await mk(-5, "PHONE", true);
    const now = new Date();
    expect(await holdAgain([phone], phone, now)).toEqual({ held: [phone], removed: 0 });
    const o = await get(phone);
    expect(o.status).toBe("PENDING_PAYMENT");
    expect(Math.round((o.holdExpiresAt!.getTime() - now.getTime()) / MIN)).toBe(10);
    // the only unit is now held again by this customer: another expired link for the same unit can't take it
    const other = await mk(-5, "PHONE", true);
    // the other link gets nothing held: its item is taken out and listed for the nearest options
    expect(await holdAgain([other], other, new Date())).toEqual({ held: [other], removed: 1 });
    expect((await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, other))).length).toBe(0);
    expect((await get(other)).linkRemoved).toHaveLength(1);
  });
  it("Admin link gets 25 minutes again", async () => {
    const { mk } = await setup(1);
    const pos = await mk(-1, "POS", true);
    const now = new Date();
    await holdAgain([pos], pos, now);
    expect(Math.round(((await get(pos)).holdExpiresAt!.getTime() - now.getTime()) / MIN)).toBe(25);
  });
  it("friendly draft wording, item or items", () => {
    expect(LINK_TEXT.expiredTitle).toBe("This payment link has expired");
    expect(LINK_TEXT.expiredBody(1)).toBe("Your item was back into stock so other customers could book. Tap below to check if it's still free for your date.");
    expect(LINK_TEXT.checkButton).toBe("Check availability again");
    expect(LINK_TEXT.gone(1)).toBe("This item is no longer available for your date."); // Abraham's wording
    expect(LINK_TEXT.gone(2)).toBe("These items are no longer available for your date.");
    expect(LINK_TEXT.goneCall).toBe("Please call us at (845) 777-7585, to choose another option or another day.");
    expect(LINK_TEXT.cardNote).toBe('After you tap "Agree and pay," you will have 10 minutes to enter your card details on our secure payment page. If your session expires, your rented items will be returned to stock, and you can check again availability to rebook at any time.');
    expect(LINK_TEXT.heldAgain(10)).toBe("It's still available! We are holding it for you for the next 10 minutes."); // Abraham's exact wording
  });
});

describe("expired link, item gone: the nearest options per item and per day (Abraham, Nov 13, 2026)", () => {
  it("two items: the free one is held again, the taken one gets its options; choosing one adds it and re-prices", async () => {
    const { removedWithOptions, chooseLinkOption } = await import("@/lib/late-payment");
    const [c] = await db.insert(schema.categories).values({ name: "Bounce houses opts", sortOrder: 9 }).returning();
    const [small, mid, big] = await db
      .insert(schema.products)
      .values([
        { categoryId: c.id, name: "Small Castle", priceCents: 15000, quantity: 1, sizeOrder: 1 },
        { categoryId: c.id, name: "Castle", priceCents: 20000, quantity: 1, sizeOrder: 2 },
        { categoryId: c.id, name: "Big Castle", priceCents: 25000, quantity: 1, sizeOrder: 3 },
      ])
      .returning();
    const [c2] = await db.insert(schema.categories).values({ name: "Games opts", sortOrder: 10 }).returning();
    const [laser] = await db.insert(schema.products).values({ categoryId: c2.id, name: "Laser tag set", priceCents: 30000, quantity: 1 }).returning();
    const day = "2026-12-22"; // Tuesday
    // Moshe has the only Castle on the 22nd
    const [moshe] = await db.insert(schema.orders).values({ status: "CONFIRMED", channel: "PHONE", eventDate: day, pickupDate: "2026-12-23" }).returning();
    await db.insert(schema.orderItems).values({ orderId: moshe.id, productId: mid.id, qty: 1, unitPriceCents: 20000 });
    // Sara's link (Castle + Laser tag) expired
    const [sara] = await db.insert(schema.orders).values({ status: "PENDING_PAYMENT", channel: "PHONE", eventDate: day, pickupDate: "2026-12-23", holdExpiresAt: new Date(Date.now() - 60_000), subtotalCents: 50000, totalCents: 54063 }).returning();
    await db.insert(schema.orderItems).values([
      { orderId: sara.id, productId: mid.id, qty: 1, unitPriceCents: 20000 },
      { orderId: sara.id, productId: laser.id, qty: 1, unitPriceCents: 30000 },
    ]);
    expect(await holdAgain([sara.id], sara.id)).toEqual({ held: [sara.id], removed: 1 });
    const held = await get(sara.id);
    expect(held.status).toBe("PENDING_PAYMENT");
    expect(held.subtotalCents).toBe(30000); // the Laser tag set stays, held again
    const list = await removedWithOptions(sara.id);
    expect(list.map((r) => [r.name, r.eventDate])).toEqual([["Castle", day]]);
    // Moshe's Castle is out the 22nd and 23rd, so a booking on the 21st (back on the 22nd) can't fit either:
    // the nearest free days are the 20th and the 24th, the same the phone line offers
    expect(list[0].options.map((o) => [o.kind, o.name, o.date])).toEqual([
      ["bigger", "Big Castle", day],
      ["smaller", "Small Castle", day],
      ["before", "Castle", "2026-12-20"],
      ["after", "Castle", "2026-12-24"],
    ]);
    // a made-up choice (not offered) is refused
    expect(await chooseLinkOption(sara.id, 0, mid.id, day)).toBe(false);
    // same day, a size bigger: added to the same order and re-priced
    expect(await chooseLinkOption(sara.id, 0, big.id, day)).toBe(true);
    const lines = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, sara.id));
    expect(lines.map((l) => l.productId).sort()).toEqual([big.id, laser.id].sort());
    expect((await get(sara.id)).subtotalCents).toBe(55000);
    expect((await get(sara.id)).linkRemoved).toEqual([]);
    void small;
  });
  it("another day: the item joins the same payment as a second rental day", async () => {
    const { removedWithOptions, chooseLinkOption } = await import("@/lib/late-payment");
    const { getPaymentGroup } = await import("@/lib/orders");
    const [c] = await db.insert(schema.categories).values({ name: "Paddle", sortOrder: 11 }).returning();
    const [boat] = await db.insert(schema.products).values({ categoryId: c.id, name: "Paddle boat", priceCents: 10000, quantity: 1 }).returning();
    const [ball] = await db.insert(schema.products).values({ categoryId: c.id, name: "Ball pit", priceCents: 8000, quantity: 1 }).returning();
    const day = "2027-01-05";
    const [other] = await db.insert(schema.orders).values({ status: "CONFIRMED", channel: "PHONE", eventDate: day, pickupDate: "2027-01-06" }).returning();
    await db.insert(schema.orderItems).values({ orderId: other.id, productId: boat.id, qty: 1, unitPriceCents: 10000 });
    const [sara] = await db.insert(schema.orders).values({ status: "CANCELLED", channel: "PHONE", eventDate: day, pickupDate: "2027-01-06", subtotalCents: 18000 }).returning();
    await db.insert(schema.orderItems).values([
      { orderId: sara.id, productId: boat.id, qty: 1, unitPriceCents: 10000 },
      { orderId: sara.id, productId: ball.id, qty: 1, unitPriceCents: 8000 },
    ]);
    await holdAgain([sara.id], sara.id);
    const [entry] = await removedWithOptions(sara.id);
    const later = entry.options.find((o) => o.kind === "after")!;
    expect(await chooseLinkOption(sara.id, entry.index, boat.id, later.date)).toBe(true);
    const group = await getPaymentGroup(sara.id);
    expect(group!.orders.map((d) => [d.order.eventDate, d.items.map((i) => i.productId)])).toEqual([
      [day, [ball.id]],
      [later.date, [boat.id]],
    ]);
    expect(group!.orders.every((d) => d.order.status === "PENDING_PAYMENT")).toBe(true);
  });
});
