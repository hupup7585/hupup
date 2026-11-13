import { and, asc, eq, ne, or, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { orderNumber } from "@/lib/orders";

/**
 * Driver assignment (Abraham, Nov 12, 2026): a driver for each delivery and each pickup. A Delivery login sees and
 * acts on only its own stops (checked on the server). Overlapping jobs are a warning, never a block.
 */
export type Stop = "delivery" | "pickup";
type DriverFields = { id: number; status: string; eventDate: string | null; pickupDate: string | null; deliveryTime: string | null; deliveryDriverId: number | null; pickupDriverId: number | null };

export const driverOf = (o: Pick<DriverFields, "deliveryDriverId" | "pickupDriverId">, stop: Stop) => (stop === "delivery" ? o.deliveryDriverId : o.pickupDriverId);

/** Is this stop assigned to this driver? */
export function isMyStop(o: Pick<DriverFields, "deliveryDriverId" | "pickupDriverId">, stop: Stop, userId: number | null) {
  return userId !== null && driverOf(o, stop) === userId;
}

/** Does this driver have either stop of the order? (for actions that aren't tied to one stop, like a text) */
export function hasAnyStop(o: Pick<DriverFields, "deliveryDriverId" | "pickupDriverId">, userId: number | null) {
  return userId !== null && (o.deliveryDriverId === userId || o.pickupDriverId === userId);
}

/** Active Delivery logins, for the assignment lists. */
export async function activeDrivers() {
  return db
    .select({ id: schema.adminUsers.id, name: schema.adminUsers.name })
    .from(schema.adminUsers)
    .where(and(eq(schema.adminUsers.role, "delivery"), eq(schema.adminUsers.active, true)))
    .orderBy(asc(schema.adminUsers.name));
}

const LIVE = ["PENDING_PAYMENT", "CONFIRMED", "DELIVERED", "PICKED_UP", "HOLD"] as const;

/**
 * Other jobs of the same driver that overlap this stop: same day and same kind of stop (deliveries share one
 * delivery window, pickups share one pickup time), unless both have different delivery times set.
 */
export async function overlapsFor(o: DriverFields, stop: Stop): Promise<string[]> {
  const driver = driverOf(o, stop);
  const day = stop === "delivery" ? o.eventDate : o.pickupDate;
  if (!driver || !day) return [];
  const others = await db
    .select()
    .from(schema.orders)
    .where(
      and(
        ne(schema.orders.id, o.id),
        inArray(schema.orders.status, [...LIVE]),
        or(and(eq(schema.orders.deliveryDriverId, driver), eq(schema.orders.eventDate, day)), and(eq(schema.orders.pickupDriverId, driver), eq(schema.orders.pickupDate, day))),
      ),
    );
  const out: string[] = [];
  for (const x of others) {
    for (const s of ["delivery", "pickup"] as const) {
      if (driverOf(x, s) !== driver || (s === "delivery" ? x.eventDate : x.pickupDate) !== day || s !== stop) continue;
      if (o.deliveryTime && x.deliveryTime && o.deliveryTime !== x.deliveryTime) continue;
      out.push(`${s === "delivery" ? "Delivery" : "Pickup"} for order #${orderNumber(x.id)}${x.deliveryTime ? ` at ${x.deliveryTime}` : ""}`);
    }
  }
  return out;
}

/** Owner or Secretary assigns (or clears) a driver. Audited. */
export async function assignDriver(orderId: number, stop: Stop, driverId: number | null, userId: number | null) {
  if (driverId !== null) {
    const [d] = await db.select().from(schema.adminUsers).where(eq(schema.adminUsers.id, driverId)).limit(1);
    if (!d || d.role !== "delivery" || !d.active) throw new Error("Choose an active driver.");
  }
  const [before] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
  if (!before) throw new Error("Order not found.");
  const field = stop === "delivery" ? { deliveryDriverId: driverId } : { pickupDriverId: driverId };
  const [after] = await db.update(schema.orders).set(field).where(eq(schema.orders.id, orderId)).returning();
  await db.insert(schema.auditLog).values({
    userId,
    action: `order.${stop}_driver`,
    entityType: "order",
    entityId: String(orderId),
    before: { driverId: driverOf(before, stop) },
    after: { driverId },
  });
  return overlapsFor(after, stop);
}
