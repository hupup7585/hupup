import { eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import { checkBookable } from "@/lib/availability";
import type { db } from "@/lib/db";


type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Line = typeof schema.orderItems.$inferSelect;

/**
 * Checks an order's items again as ONE order (Hark's website list A1, Nov 26, 2026). Each item used to be checked on
 * its own while the rest of the order was out of the count, so two items sharing a unit (the maze group, the laser
 * gun pools) or the same item on two lines could both pass when only one was free.
 *
 * Call inside a transaction with the products already locked, and with the order already counting (active hold).
 * The order's lines are taken out, then put back one at a time: each is checked with the lines already put back
 * counted. A line that no longer fits stays out and is returned. Lines keep their ids and prices.
 */
export async function recheckOrderLines(tx: Tx, order: { id: number; eventDate: string; pickupDate: string }): Promise<Line[]> {
  const lines = (await tx.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, order.id))).sort((a, b) => a.productId - b.productId || a.id - b.id);
  if (!lines.length) return [];
  await tx.delete(schema.orderItems).where(eq(schema.orderItems.orderId, order.id));
  const out: Line[] = [];
  for (const l of lines) {
    const [p] = await tx.select({ quantity: schema.products.quantity, active: schema.products.active }).from(schema.products).where(eq(schema.products.id, l.productId)).limit(1);
    const free = p?.active ? await checkBookable(l.productId, p.quantity, order.eventDate, tx, order.pickupDate) : 0;
    if (free >= l.qty) await tx.insert(schema.orderItems).values(l);
    else out.push(l);
  }
  return out;
}

class DoesNotFit extends Error {}

/**
 * Does this order fit as a whole (shared units and laser pools counted)? Runs the line-by-line check inside the
 * caller's transaction and undoes it, so nothing changes; throws only through `withFitCheck`.
 */
export async function assertOrderFits(tx: Tx, order: { id: number; eventDate: string; pickupDate: string }) {
  if ((await recheckOrderLines(tx, order)).length) throw new DoesNotFit();
}

/** Runs `fn` in a transaction; false (and nothing changed) when `assertOrderFits` found the order no longer fits. */
export async function withFitCheck(dbx: typeof db, fn: (tx: Tx) => Promise<boolean>): Promise<boolean> {
  try {
    return await dbx.transaction(fn);
  } catch (e) {
    if (e instanceof DoesNotFit) return false;
    throw e;
  }
}
