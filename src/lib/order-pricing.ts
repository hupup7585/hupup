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
  const t = await priceOrder(o.subtotalCents, o.deliveryAddress, s, undefined, o.eventDate);
  if (!t) return false; // outside every zone, or not found: never guessed (pricingProblem says which)
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


/** Why an order has no delivery price, in words for staff (Abraham, Nov 15, 2026). Null = it can be priced. */
export async function pricingProblem(orderId: number): Promise<string | null> {
  const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
  if (!o || o.totalCents !== null) return null;
  const s = await getSettings();
  const { deliveryQuote, spellingHint } = await import("@/lib/delivery-areas");
  const q = await deliveryQuote(o.deliveryAddress, s);
  if (q.ok) return null;
  if (q.reason === "outside") return "We don't deliver to this address: the house is outside every zone on the delivery price map.";
  if (q.reason === "no_address") return "Add the delivery address first (house number, street, town and ZIP).";
  if (q.reason === "no_price") return "This zone has no price yet. Ask the Owner to set it in Delivery settings.";
  const hint = o.deliveryAddress ? spellingHint(o.deliveryAddress, s.localStreets) : null;
  return `This address could not be found on the map. Check the spelling of the house number, street, town and ZIP${hint ? ` (did you mean ${hint}?)` : ""}, fix it on the order, and try again.`;
}
