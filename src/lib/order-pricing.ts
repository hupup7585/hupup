import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { priceOrder } from "@/lib/pricing";

/**
 * Every payment link charges items + delivery + tax (Abraham, Nov 12, 2026). Phone orders are priced at checkout;
 * orders made in Admin (New booking) and older orders get priced here, from their delivery address, before a link
 * is made. Already-priced orders are left as they are. Returns false when the address isn't in the delivery area
 * (or there is none), so no link goes out for the items alone.
 */
export async function ensurePriced(orderId: number): Promise<boolean> {
  const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
  if (!o) return false;
  if (o.totalCents !== null) return true;
  const s = await getSettings();
  const t = await priceOrder(o.subtotalCents, o.deliveryAddress, s);
  if (!t) {
    // No price for this address (outside every area on the price map, or not found): never guessed. Staff quote it.
    await flagForQuote(o.id, o.deliveryAddress);
    return false;
  }
  await db
    .update(schema.orders)
    .set({ deliveryZone: t.zone, deliveryFeeCents: t.deliveryFeeCents, taxPercent: t.taxPercent, taxCents: t.taxCents, totalCents: t.totalCents, updatedAt: new Date() })
    .where(eq(schema.orders.id, orderId));
  return true;
}

/** Prices every order in a payment group (several rental days paid with one link). */
export async function ensureGroupPriced(orderIds: number[]): Promise<boolean> {
  let ok = true;
  for (const id of orderIds) ok = (await ensurePriced(id)) && ok;
  return ok;
}

/** One task per order: "Quote delivery" with the address and why (Abraham, Nov 15, 2026). */
export async function flagForQuote(orderId: number, address: string | null) {
  const { orderNumber } = await import("@/lib/orders");
  const title = `Quote delivery: order #${orderNumber(orderId)}`;
  const [have] = await db.select({ id: schema.tasks.id }).from(schema.tasks).where(eq(schema.tasks.title, title)).limit(1);
  if (have) return;
  await db.insert(schema.tasks).values({
    title,
    notes: `${address ? `The address "${address}"` : "This order has no delivery address, so it"} has no delivery price on the price map. Call the customer with a delivery fee, enter it on the order page (Delivery fee, quoted by staff), then send the payment link.`,
    priority: "high",
    dueDate: new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }),
  });
}
