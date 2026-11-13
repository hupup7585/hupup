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
  it("preview only until Abraham approves the wording", () => {
    expect(LINK_WORDING_APPROVED).toBe(false);
    expect(linkRulesActive({ VERCEL_ENV: "production" })).toBe(false);
    expect(linkRulesActive({ VERCEL_ENV: "preview" })).toBe(true);
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
    expect(LINK_TEXT.expiredBody(1)).toContain("Your item was held");
    expect(LINK_TEXT.expiredBody(2)).toContain("Your items were held");
    expect(LINK_TEXT.gone(2)).toBe("Sorry, these items are no longer available for your date.");
    expect(LINK_TEXT.cardNote).toContain("10 minutes");
  });
});
