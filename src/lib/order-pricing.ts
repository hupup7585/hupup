import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { computeTotals, deliveryZone } from "@/lib/pricing";

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
  const t = computeTotals(o.subtotalCents, deliveryZone(o.deliveryAddress, s), s);
  if (!t) return false;
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
