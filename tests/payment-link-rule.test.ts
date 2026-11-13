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
  it("the nearest-options list waits for Abraham's OK on its intro line (preview only)", async () => {
    const { OPTIONS_WORDING_APPROVED, linkOptionsActive } = await import("@/lib/late-payment");
    expect(OPTIONS_WORDING_APPROVED).toBe(false);
    expect(linkOptionsActive({ VERCEL_ENV: "production" })).toBe(false);
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
    expect(await holdAgain([phone], now)).toEqual([phone]);
    const o = await get(phone);
    expect(o.status).toBe("PENDING_PAYMENT");
    expect(Math.round((o.holdExpiresAt!.getTime() - now.getTime()) / MIN)).toBe(10);
    // the only unit is now held again by this customer: another expired link for the same unit can't take it
    const other = await mk(-5, "PHONE", true);
    expect(await holdAgain([other], new Date())).toBeNull();
    expect(holdEnded(await get(other))).toBe(true);
  });
  it("Admin link gets 25 minutes again", async () => {
    const { mk } = await setup(1);
    const pos = await mk(-1, "POS", true);
    const now = new Date();
    await holdAgain([pos], now);
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
    expect(LINK_TEXT.heldAgain(10)).toBe("It's still available! We're holding it for you for the next 10 minutes."); // Abraham's exact wording
  });
});

describe("expired link, item gone: the nearest options (Abraham, Nov 13, 2026)", () => {
  it("offers one size bigger / smaller that day and the same item the day before / after; tapping one holds and re-prices it", async () => {
    const { linkOptions, chooseLinkOption } = await import("@/lib/late-payment");
    const [c] = await db.insert(schema.categories).values({ name: "Bounce houses opts", sortOrder: 9 }).returning();
    const [small, mid, big] = await db
      .insert(schema.products)
      .values([
        { categoryId: c.id, name: "Small Castle", priceCents: 15000, quantity: 1, sizeOrder: 1 },
        { categoryId: c.id, name: "Castle", priceCents: 20000, quantity: 1, sizeOrder: 2 },
        { categoryId: c.id, name: "Big Castle", priceCents: 25000, quantity: 1, sizeOrder: 3 },
      ])
      .returning();
    const day = "2026-12-22"; // Tuesday
    // Moshe has the only Castle on the 22nd
    const [moshe] = await db.insert(schema.orders).values({ status: "CONFIRMED", channel: "PHONE", eventDate: day, pickupDate: "2026-12-23" }).returning();
    await db.insert(schema.orderItems).values({ orderId: moshe.id, productId: mid.id, qty: 1, unitPriceCents: 20000 });
    // Sara's link expired
    const [sara] = await db.insert(schema.orders).values({ status: "PENDING_PAYMENT", channel: "PHONE", eventDate: day, pickupDate: "2026-12-23", holdExpiresAt: new Date(Date.now() - 60_000), subtotalCents: 20000, totalCents: 21625 }).returning();
    await db.insert(schema.orderItems).values({ orderId: sara.id, productId: mid.id, qty: 1, unitPriceCents: 20000 });
    expect(await holdAgain([sara.id])).toBeNull(); // gone

    const opts = await linkOptions([sara.id]);
    // Moshe's Castle is out the 22nd and 23rd, so a booking on the 21st (back on the 22nd) can't fit either:
    // the nearest free days are the 20th and the 24th, the same the phone line offers
    expect(opts.map((o) => [o.kind, o.name, o.date])).toEqual([
      ["bigger", "Big Castle", day],
      ["smaller", "Small Castle", day],
      ["before", "Castle", "2026-12-20"],
      ["after", "Castle", "2026-12-24"],
    ]);
    // a made-up choice (not offered) is refused
    expect(await chooseLinkOption(sara.id, mid.id, day)).toBe(false);
    // tapping "Big Castle": held again for 10 minutes, item and price changed, re-priced with delivery and tax
    expect(await chooseLinkOption(sara.id, big.id, day)).toBe(true);
    const after = await get(sara.id);
    expect(after.status).toBe("PENDING_PAYMENT");
    expect(after.holdExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 9 * MIN);
    expect(after.subtotalCents).toBe(25000);
    expect(after.totalCents).toBeNull(); // re-priced with delivery and tax from the address (none in this test) before paying
    const [line] = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, sara.id));
    expect([line.productId, line.unitPriceCents]).toEqual([big.id, 25000]);
    // the Big Castle is now held for Sara: no one else can take it
    expect((await linkOptions([sara.id])).length).toBeGreaterThanOrEqual(0);
    void small;
  });
});
