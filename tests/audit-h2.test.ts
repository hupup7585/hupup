import { beforeAll, describe, expect, it, vi } from "vitest";

/* Audit H2 (Nov 24, 2026): a new address in Admin re-prices delivery, tax and total; an audit row records it. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requireAdmin: async () => ({ userId: null, role: "owner" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/delivery-areas", async (orig) => ({
  ...(await orig<typeof import("@/lib/delivery-areas")>()),
  deliveryQuote: async (address: string | null) =>
    !address ? { ok: false, reason: "no_address" } : /kiryas/i.test(address) ? { ok: true, zone: "KJ", feeCents: 1000, kind: "local" } : /monroe/i.test(address) ? { ok: true, zone: "Monroe", feeCents: 1500, kind: "local" } : { ok: false, reason: "outside" },
}));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { ensurePriced } from "@/lib/order-pricing";
import { taxOn } from "@/lib/pricing";
import { getSettings } from "@/lib/settings";
import { sendPayLinkAction, updateDetailsAction } from "@/app/admin/(app)/orders/actions";

const order = async (id: number) => (await db.select().from(schema.orders).where(eq(schema.orders.id, id)))[0];
const form = (address: string) => {
  const f = new FormData();
  f.set("deliveryAddress", address);
  f.set("notes", "");
  return f;
};
let id = 0;
let rate = "8.125";

beforeAll(async () => {
  rate = String((await getSettings()).salesTaxPercent);
  const [o] = await db.insert(schema.orders).values({ status: "PENDING_PAYMENT", channel: "POS", eventDate: "2026-12-15", pickupDate: "2026-12-16", deliveryAddress: "5 Forest Rd, Kiryas Joel, NY 10950", subtotalCents: 20000 }).returning();
  id = o.id;
  expect(await ensurePriced(id)).toBe(true);
  expect((await order(id)).deliveryFeeCents).toBe(1000);
});

describe("address changed in Admin", () => {
  it("Kiryas Joel ($10) to a Monroe $15 address: delivery, tax and total follow the new address; audit row", async () => {
    const r = await updateDetailsAction(id, form("12 Forest Road, Monroe, NY 10950"));
    expect(r).toEqual({ ok: true, message: "Saved" });
    const o = await order(id);
    const tax = taxOn(20000 + 1500, rate);
    expect([o.deliveryFeeCents, o.taxCents, o.totalCents, o.deliveryZone]).toEqual([1500, tax, 21500 + tax, "Monroe"]);
    const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, String(id)));
    expect(audit.at(-1)).toMatchObject({ action: "order.details", before: { deliveryFeeCents: 1000 }, after: { deliveryFeeCents: 1500 } });
  });
  it("out of the delivery area: staff see why, and no payment link can be sent", async () => {
    const r = await updateDetailsAction(id, form("5 Main St, Albany, NY 12207"));
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/^Saved, but no payment link can be sent: We don't deliver to this address/);
    expect((await order(id)).totalCents).toBeNull();
    expect((await sendPayLinkAction(id)).ok).toBe(false);
  });
  it("a paid order keeps its price when the address changes", async () => {
    await updateDetailsAction(id, form("12 Forest Road, Monroe, NY 10950"));
    await db.update(schema.orders).set({ paidCents: 500 }).where(eq(schema.orders.id, id));
    const before = await order(id);
    const r = await updateDetailsAction(id, form("5 Forest Rd, Kiryas Joel, NY 10950"));
    expect(r.message).toBe("Saved. Payment was already taken, so the price did not change.");
    expect((await order(id)).totalCents).toBe(before.totalCents);
  });
  it("items changed after pricing: the total follows (same delivery fee, tax on the new amount)", async () => {
    const { refreshOrderTotals } = await import("@/lib/orders");
    const [c] = await db.insert(schema.categories).values({ name: "Jumping Balloons", ivrDigit: 1, sortOrder: 1, active: true }).returning();
    const [p] = await db.insert(schema.products).values({ categoryId: c.id, name: "Castle", priceCents: 30000, quantity: 3, active: true }).returning();
    const [o] = await db.insert(schema.orders).values({ status: "PENDING_PAYMENT", channel: "POS", eventDate: "2026-12-17", pickupDate: "2026-12-18", deliveryAddress: "12 Forest Road, Monroe", subtotalCents: 0 }).returning();
    await db.insert(schema.orderItems).values({ orderId: o.id, productId: p.id, qty: 1, unitPriceCents: 30000 });
    await ensurePriced(o.id);
    await db.update(schema.orderItems).set({ qty: 2 }).where(eq(schema.orderItems.orderId, o.id));
    await refreshOrderTotals(o.id);
    const after = await order(o.id);
    const tax = taxOn(60000 + 1500, rate);
    expect([after.subtotalCents, after.deliveryFeeCents, after.taxCents, after.totalCents]).toEqual([60000, 1500, tax, 61500 + tax]);
  });
});
