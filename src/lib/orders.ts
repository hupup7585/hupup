import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { addDays } from "@/lib/dates";
import { checkBookable } from "@/lib/availability";
import type { Channel, OrderStatus } from "@/lib/db/schema";

const { orders, orderItems, products, customers } = schema;

/** How long a phone cart holds stock if the call-ended webhook never arrives. */
export const PHONE_HOLD_MINUTES = 15;
/** How long a texted payment link holds stock before it's released. */
export const PAYMENT_HOLD_MINUTES = 15;

export function orderNumber(id: number): string {
  return String(1000 + id);
}

export function minutesFromNow(m: number): Date {
  return new Date(Date.now() + m * 60_000);
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ReserveResult =
  | { ok: true; orderId: number }
  | { ok: false; reason: "unavailable"; free: number }
  | { ok: false; reason: "inactive" | "date_mismatch" | "not_found" };

/**
 * Atomically add `qty` of a product to an order (creating the order if needed).
 * Locks the product row so two simultaneous callers can never both get the last unit.
 */
async function reserveInTx(
  tx: Tx,
  opts: {
    orderId?: number | null;
    productId: number;
    qty: number;
    eventDate: string;
    channel: Channel;
    status?: OrderStatus;
    holdExpiresAt?: Date | null;
    callSid?: string | null;
  },
): Promise<ReserveResult> {
  const locked = await tx.execute(
    sql`SELECT id, quantity, price_cents, active FROM products WHERE id = ${opts.productId} FOR UPDATE`,
  );
  const p = locked.rows[0] as { id: number; quantity: number; price_cents: number; active: boolean } | undefined;
  if (!p) return { ok: false, reason: "not_found" };
  if (!p.active) return { ok: false, reason: "inactive" };

  let orderId = opts.orderId ?? null;
  if (orderId) {
    const [o] = await tx.select().from(orders).where(eq(orders.id, orderId));
    if (!o) return { ok: false, reason: "not_found" };
    if (o.eventDate !== opts.eventDate) return { ok: false, reason: "date_mismatch" };
  }

  const free = await checkBookable(p.id, p.quantity, opts.eventDate, tx);
  if (free < opts.qty) return { ok: false, reason: "unavailable", free };

  if (!orderId) {
    const [o] = await tx
      .insert(orders)
      .values({
        status: opts.status ?? "HOLD",
        channel: opts.channel,
        eventDate: opts.eventDate,
        pickupDate: addDays(opts.eventDate, 1),
        holdExpiresAt: opts.holdExpiresAt ?? null,
        callSid: opts.callSid ?? null,
      })
      .returning({ id: orders.id });
    orderId = o.id;
  } else if (opts.holdExpiresAt) {
    await tx.update(orders).set({ holdExpiresAt: opts.holdExpiresAt }).where(eq(orders.id, orderId));
  }

  const [existing] = await tx
    .select()
    .from(orderItems)
    .where(and(eq(orderItems.orderId, orderId), eq(orderItems.productId, p.id)));
  if (existing) {
    await tx
      .update(orderItems)
      .set({ qty: existing.qty + opts.qty })
      .where(eq(orderItems.id, existing.id));
  } else {
    await tx.insert(orderItems).values({ orderId, productId: p.id, qty: opts.qty, unitPriceCents: p.price_cents });
  }
  await recalcSubtotal(tx, orderId);
  return { ok: true, orderId };
}

async function recalcSubtotal(tx: Tx | typeof db, orderId: number) {
  await tx.execute(sql`
    UPDATE orders SET
      subtotal_cents = COALESCE((SELECT SUM(qty * unit_price_cents) FROM order_items WHERE order_id = ${orderId}), 0),
      updated_at = now()
    WHERE id = ${orderId}
  `);
}

/** Phone cart: add one product to the caller's held order. */
export async function reserveItem(opts: Parameters<typeof reserveInTx>[1]): Promise<ReserveResult> {
  return db.transaction((tx) => reserveInTx(tx, opts));
}

/**
 * POS: create a whole order with several items in one transaction.
 * Products are locked in id order to avoid deadlocks.
 */
export async function createOrderWithItems(opts: {
  items: { productId: number; qty: number }[];
  eventDate: string;
  channel: Channel;
  status: OrderStatus;
  holdExpiresAt?: Date | null;
  customer?: { name: string; phone?: string | null; email?: string | null; address?: string | null };
  deliveryAddress?: string | null;
  deliveryTime?: string | null;
  notes?: string | null;
  paymentMethod?: string | null;
  paidCents?: number;
}): Promise<ReserveResult> {
  const items = [...opts.items].filter((i) => i.qty > 0).sort((a, b) => a.productId - b.productId);
  if (!items.length) return { ok: false, reason: "not_found" };
  try {
    return await db.transaction(async (tx) => {
      let orderId: number | null = null;
      for (const it of items) {
        const r = await reserveInTx(tx, {
          orderId,
          productId: it.productId,
          qty: it.qty,
          eventDate: opts.eventDate,
          channel: opts.channel,
          status: opts.status,
          holdExpiresAt: opts.holdExpiresAt ?? null,
        });
        if (!r.ok) {
          // Abort the whole order.
          throw new RollbackSignal(r);
        }
        orderId = r.orderId;
      }
      let customerId: number | null = null;
      if (opts.customer?.name) {
        customerId = await upsertCustomer(tx, opts.customer);
      }
      await tx
        .update(orders)
        .set({
          customerId,
          deliveryAddress: opts.deliveryAddress ?? opts.customer?.address ?? null,
          deliveryTime: opts.deliveryTime ?? null,
          notes: opts.notes ?? null,
          paymentMethod: opts.paymentMethod ?? null,
          paidCents: opts.paidCents ?? 0,
        })
        .where(eq(orders.id, orderId!));
      return { ok: true as const, orderId: orderId! };
    });
  } catch (e) {
    if (e instanceof RollbackSignal) return e.result;
    throw e;
  }
}

class RollbackSignal extends Error {
  constructor(public result: ReserveResult) {
    super("rollback");
  }
}

export async function upsertCustomer(
  tx: Tx | typeof db,
  c: { name: string; phone?: string | null; email?: string | null; address?: string | null },
): Promise<number> {
  if (c.phone) {
    const [found] = await tx.select().from(customers).where(eq(customers.phone, c.phone)).limit(1);
    if (found) {
      await tx
        .update(customers)
        .set({
          name: c.name || found.name,
          email: c.email || found.email,
          address: c.address || found.address,
        })
        .where(eq(customers.id, found.id));
      return found.id;
    }
  }
  const [row] = await tx
    .insert(customers)
    .values({ name: c.name, phone: c.phone ?? null, email: c.email ?? null, address: c.address ?? null })
    .returning({ id: customers.id });
  return row.id;
}

export async function getOrderWithItems(orderId: number) {
  const [o] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!o) return null;
  const items = await db
    .select({
      id: orderItems.id,
      productId: orderItems.productId,
      qty: orderItems.qty,
      unitPriceCents: orderItems.unitPriceCents,
      name: products.name,
    })
    .from(orderItems)
    .innerJoin(products, eq(products.id, orderItems.productId))
    .where(eq(orderItems.orderId, orderId))
    .orderBy(orderItems.id);
  const customer = o.customerId
    ? (await db.select().from(customers).where(eq(customers.id, o.customerId)))[0] ?? null
    : null;
  return { order: o, items, customer };
}

export async function setOrderStatus(orderId: number, status: OrderStatus, extra: Partial<typeof orders.$inferInsert> = {}) {
  await db
    .update(orders)
    .set({ status, updatedAt: new Date(), ...extra })
    .where(eq(orders.id, orderId));
}

/** Empty a held cart (keeps the order row as CANCELLED for the call log). */
export async function cancelHold(orderId: number) {
  await db
    .update(orders)
    .set({ status: "CANCELLED", holdExpiresAt: null, updatedAt: new Date(), notes: sql`COALESCE(${orders.notes}, '') || 'Hold released. '` })
    .where(and(eq(orders.id, orderId), eq(orders.status, "HOLD")));
}

/** Release every hold/payment-pending order whose time ran out. Returns count. */
export async function releaseExpired(): Promise<number> {
  const res = await db
    .update(orders)
    .set({ status: "CANCELLED", updatedAt: new Date(), notes: sql`COALESCE(${orders.notes}, '') || 'Expired hold released. '` })
    .where(and(inArray(orders.status, ["HOLD", "PENDING_PAYMENT"]), lt(orders.holdExpiresAt, new Date())))
    .returning({ id: orders.id });
  return res.length;
}

/** Mark an order paid (from Sola webhook or manual entry). Idempotent. */
export async function markPaid(orderId: number, cents: number, method: string, ref?: string | null) {
  const [o] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!o) return null;
  if (ref && o.solaRefNum === ref) return o; // duplicate webhook
  const paid = o.paidCents + cents;
  const status: OrderStatus =
    o.status === "PENDING_PAYMENT" || o.status === "HOLD" || o.status === "CANCELLED" ? "CONFIRMED" : o.status;
  const [updated] = await db
    .update(orders)
    .set({
      paidCents: paid,
      paymentMethod: method,
      solaRefNum: ref ?? o.solaRefNum,
      status,
      holdExpiresAt: null,
      updatedAt: new Date(),
      notes:
        o.status === "CANCELLED"
          ? sql`COALESCE(${orders.notes}, '') || 'Payment arrived after hold expired - re-confirmed, check availability. '`
          : o.notes,
    })
    .where(eq(orders.id, orderId))
    .returning();
  return updated;
}
