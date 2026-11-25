import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { addDays } from "@/lib/dates";
import { checkBookable, pickupDateFor } from "@/lib/availability";
import { getSettings } from "@/lib/settings";
import type { Channel, OrderStatus } from "@/lib/db/schema";
import { orderPath } from "@/lib/order-path";

const { orders, orderItems, products, customers } = schema;

/** How long a phone cart holds stock if the call-ended webhook never arrives. */
export const PHONE_HOLD_MINUTES = 15;
/** How long a texted payment link holds stock before it's released. */
export const PAYMENT_HOLD_MINUTES = 10; // Abraham, Nov 13, 2026: rentals are held 10 minutes while the caller pays
/** Admin New booking payment link: rentals held 25 minutes (Abraham, Nov 13, 2026; was 60). */
export const POS_LINK_HOLD_MINUTES = 25;

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
  | { ok: false; reason: "inactive" | "date_mismatch" | "not_found" | "needs_maze" };

/**
 * Atomically add `qty` of a product to an order (creating the order if needed).
 * Locks the product row so two simultaneous callers can never both get the last unit.
 */
/** An additional gun pack (the hidden "Laser tag add-ons" group). */
export async function isLaserAddon(exec: { execute: typeof db.execute }, productId: number): Promise<boolean> {
  const r = await exec.execute(sql`SELECT 1 FROM products p JOIN categories c ON c.id = p.category_id WHERE p.id = ${productId} AND c.name ~* '^laser tag add-ons$'`);
  return r.rows.length > 0;
}
/** The booking has an inflatable maze (laser category, "maze" in the name). */
export async function orderHasMaze(exec: { execute: typeof db.execute }, orderId: number): Promise<boolean> {
  const r = await exec.execute(sql`
    SELECT 1 FROM order_items oi JOIN products p ON p.id = oi.product_id JOIN categories c ON c.id = p.category_id
    WHERE oi.order_id = ${orderId} AND c.name ~* 'laser' AND c.name !~* 'add-ons' AND p.name ~* 'maze' LIMIT 1`);
  return r.rows.length > 0;
}
/** Remove the additional gun packs from a booking that no longer has a maze (Abraham, Nov 24, 2026). Returns how many lines. */
export async function dropOrphanPacks(exec: { execute: typeof db.execute }, orderId: number): Promise<number> {
  if (await orderHasMaze(exec, orderId)) return 0;
  const r = await exec.execute(sql`
    DELETE FROM order_items oi USING products p, categories c
    WHERE oi.order_id = ${orderId} AND p.id = oi.product_id AND c.id = p.category_id AND c.name ~* '^laser tag add-ons$'
    RETURNING oi.id`);
  return r.rows.length;
}

async function reserveInTx(
  tx: Tx,
  opts: {
    orderId?: number | null;
    productId: number;
    qty: number;
    eventDate: string;
    /** Real pickup day (next open day); computed before the transaction */
    pickupDate?: string;
    channel: Channel;
    status?: OrderStatus;
    holdExpiresAt?: Date | null;
    callSid?: string | null;
    /** The maze rule was already checked for the whole order (createOrderWithItems) */
    mazeChecked?: boolean;
  },
): Promise<ReserveResult> {
  const pickupDate = opts.pickupDate ?? addDays(opts.eventDate, 1);
  // Items that share one unit (the maze): lock the whole group first, in id order, so two callers can't take it at the
  // same moment (and never lock the group in two different orders)
  await tx.execute(sql`SELECT id FROM products WHERE stock_group = (SELECT stock_group FROM products WHERE id = ${opts.productId}) ORDER BY id FOR UPDATE`);
  // Laser items share their gun packs (Nov 24, 2026): lock every laser item, in id order, so two callers can never both
  // take the last six-pack
  await tx.execute(sql`
    SELECT p.id FROM products p JOIN categories c ON c.id = p.category_id
    WHERE c.name ~* 'laser' AND EXISTS (SELECT 1 FROM products q JOIN categories qc ON qc.id = q.category_id WHERE q.id = ${opts.productId} AND qc.name ~* 'laser')
    ORDER BY p.id FOR UPDATE OF p`);
  const locked = await tx.execute(
    sql`SELECT id, quantity, price_cents, active FROM products WHERE id = ${opts.productId} FOR UPDATE`,
  );
  const p = locked.rows[0] as { id: number; quantity: number; price_cents: number; active: boolean } | undefined;
  if (!p) return { ok: false, reason: "not_found" };
  if (!p.active) return { ok: false, reason: "inactive" };
  // The additional gun packs go only with an inflatable maze on the same booking (Abraham, Nov 24, 2026), never with
  // plain laser guns. createOrderWithItems checks its whole list first, then skips this per item.
  if (!opts.mazeChecked && (await isLaserAddon(tx, p.id)) && !(opts.orderId && (await orderHasMaze(tx, opts.orderId)))) return { ok: false, reason: "needs_maze" };

  let orderId = opts.orderId ?? null;
  let heldUntil = pickupDate;
  if (orderId) {
    const [o] = await tx.select().from(orders).where(eq(orders.id, orderId));
    if (!o) return { ok: false, reason: "not_found" };
    if (o.eventDate !== opts.eventDate) return { ok: false, reason: "date_mismatch" };
    // Audit H1 (Nov 24, 2026): an item added to an order is out until that order's own pickup day, so it is checked
    // through that day (a rental with a different pickup goes on its own order)
    heldUntil = o.pickupDate;
  }

  const free = await checkBookable(p.id, p.quantity, opts.eventDate, tx, heldUntil);
  if (free < opts.qty) return { ok: false, reason: "unavailable", free };

  if (!orderId) {
    const [o] = await tx
      .insert(orders)
      .values({
        status: opts.status ?? "HOLD",
        channel: opts.channel,
        eventDate: opts.eventDate,
        pickupDate,
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
  // Laser gun items keep one line per item added, so "the third pack" is the third one added (Abraham, Nov 24, 2026)
  const ownLine = (await tx.execute(sql`SELECT 1 FROM products q JOIN categories c ON c.id = q.category_id WHERE q.id = ${p.id} AND c.name ~* 'laser'`)).rows.length > 0;
  if (existing && !ownLine) {
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

/**
 * Laser guns add-on price (Abraham, Nov 19, 2026): the add-on prices ($75 six-pack, $50 four-pack) apply only while an
 * inflatable maze is on the same booking. Without a maze, the guns are charged the regular price of the same guns
 * (the "6 Laser Guns" / "4 Laser Guns" item); with a maze again, the add-on price comes back. Nothing else changes.
 */
export const LASER_ADDONS_GROUP = "Laser tag add-ons";
/**
 * The laser tag add-on packs' price: the add-on price with a maze on the booking, else the regular price of the same
 * size pack (Nov 24, 2026: shared by saved orders and the booking screen's live total).
 */
export async function laserAddonPrices(tx: { execute: typeof db.execute }, rows: { key: number; name: string; cat: string; priceCents: number }[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  const addons = rows.filter((x) => x.cat === LASER_ADDONS_GROUP);
  if (!addons.length) return out;
  const hasMaze = rows.some((x) => x.cat !== LASER_ADDONS_GROUP && /laser/i.test(x.cat) && /maze/i.test(x.name));
  for (const a of addons) {
    let target = a.priceCents;
    if (!hasMaze) {
      const n = /(\d+)\s*-?\s*pack/i.exec(a.name)?.[1];
      if (n) {
        const reg = await tx.execute(sql`
          SELECT p.price_cents FROM products p JOIN categories c ON c.id = p.category_id
          WHERE c.name <> ${LASER_ADDONS_GROUP} AND c.name ~* 'laser' AND p.name !~* 'maze' AND p.name ~* ${`^[[:space:]]*${n}[[:space:]]+laser guns`}
          ORDER BY p.active DESC, p.id LIMIT 1`);
        const price = (reg.rows[0] as { price_cents: number } | undefined)?.price_cents;
        if (price) target = price;
      }
    }
    out.set(a.key, target);
  }
  // Every 3rd extra gun set on a booking is half price (Abraham, Nov 25, 2026, 14:41), in the order they were added
  const inOrder = [...addons].sort((x, y) => x.key - y.key);
  inOrder.forEach((a, i) => {
    if (i % 3 === 2) out.set(a.key, Math.round((out.get(a.key) ?? a.priceCents) / 2));
  });
  return out;
}

async function repriceLaserAddOns(tx: Tx | typeof db, orderId: number) {
  const r = await tx.execute(sql`
    SELECT oi.id, oi.unit_price_cents, p.name, p.price_cents, c.name AS cat
    FROM order_items oi JOIN products p ON p.id = oi.product_id JOIN categories c ON c.id = p.category_id
    WHERE oi.order_id = ${orderId}`);
  const rows = r.rows as { id: number; unit_price_cents: number; name: string; price_cents: number; cat: string }[];
  const targets = await laserAddonPrices(tx, rows.map((x) => ({ key: x.id, name: x.name, cat: x.cat, priceCents: x.price_cents })));
  for (const a of rows) {
    const target = targets.get(a.id);
    if (target !== undefined && target !== a.unit_price_cents) await tx.execute(sql`UPDATE order_items SET unit_price_cents = ${target} WHERE id = ${a.id}`);
  }
}

async function recalcSubtotal(tx: Tx | typeof db, orderId: number) {
  await repriceLaserAddOns(tx, orderId);
  // Offers (Abraham, Nov 17, 2026; Owner switches, all off by default): the rentals total after the one offer
  const { bestOffer, offerSwitches } = await import("@/lib/offers");
  const offer = await bestOffer(tx, orderId, await offerSwitches(tx));
  const was = (await tx.execute(sql`SELECT offer_note FROM orders WHERE id = ${orderId}`)).rows[0] as { offer_note: string | null } | undefined;
  await tx.execute(sql`
    UPDATE orders SET
      subtotal_cents = COALESCE((SELECT SUM(qty * unit_price_cents) FROM order_items WHERE order_id = ${orderId}), 0) - ${offer.discountCents},
      offer_discount_cents = ${offer.discountCents},
      offer_note = ${offer.note},
      updated_at = now()
    WHERE id = ${orderId}
  `);
  // Audit H2 (Nov 24, 2026): an order already priced keeps its total in step with its rentals: the same delivery fee,
  // sales tax on the new amount. A changed offer can change the delivery fee (the 4th Sunday), so it is priced again.
  const r = await tx.execute(sql`SELECT subtotal_cents, delivery_fee_cents, tax_percent, total_cents FROM orders WHERE id = ${orderId}`);
  const o = r.rows[0] as { subtotal_cents: number; delivery_fee_cents: number | null; tax_percent: string | null; total_cents: number | null } | undefined;
  if (!o || o.total_cents === null) return;
  if ((was?.offer_note ?? null) !== (offer.note ?? null) || o.tax_percent === null) {
    await tx.execute(sql`UPDATE orders SET total_cents = NULL, tax_cents = 0, delivery_fee_cents = 0, delivery_zone = NULL WHERE id = ${orderId}`);
    return;
  }
  const { taxOn } = await import("@/lib/pricing");
  const sub = Number(o.subtotal_cents);
  const fee = Number(o.delivery_fee_cents);
  const tax = taxOn(sub + fee, String(o.tax_percent));
  await tx.execute(sql`UPDATE orders SET tax_cents = ${tax}, total_cents = ${sub + fee + tax} WHERE id = ${orderId}`);
}

/**
 * Recompute an order's rentals total and offers (after a customer, date or offer switch changes). Orders with no item
 * lines (an Owner custom charge, or an amount set by hand) keep their amount.
 */
export async function refreshOrderTotals(orderId: number) {
  const [line] = await db.select({ id: orderItems.id }).from(orderItems).where(eq(orderItems.orderId, orderId)).limit(1);
  if (line) await recalcSubtotal(db, orderId);
}

/** Phone cart: add one product to the caller's held order. */
export async function reserveItem(opts: Parameters<typeof reserveInTx>[1]): Promise<ReserveResult> {
  const pickupDate = opts.pickupDate ?? pickupDateFor(opts.eventDate, await getSettings());
  return db.transaction((tx) => reserveInTx(tx, { ...opts, pickupDate }));
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
  /** Thursday to Sunday (Abraham, Nov 17, 2026): the Monday pickup instead of the next open day */
  pickupDate?: string;
}): Promise<ReserveResult> {
  const items = [...opts.items].filter((i) => i.qty > 0).sort((a, b) => a.productId - b.productId);
  if (!items.length) return { ok: false, reason: "not_found" };
  const pickupDate = opts.pickupDate ?? pickupDateFor(opts.eventDate, await getSettings());
  // The additional gun packs only with an inflatable maze in the same booking (Abraham, Nov 24, 2026)
  {
    let addon = false;
    let maze = false;
    for (const it of items) {
      if (await isLaserAddon(db, it.productId)) addon = true;
      const r = await db.execute(sql`SELECT 1 FROM products p JOIN categories c ON c.id = p.category_id WHERE p.id = ${it.productId} AND c.name ~* 'laser' AND c.name !~* 'add-ons' AND p.name ~* 'maze'`);
      if (r.rows.length) maze = true;
    }
    if (addon && !maze) return { ok: false, reason: "needs_maze" };
  }
  try {
    return await db.transaction(async (tx) => {
      let orderId: number | null = null;
      for (const it of items) {
        const r = await reserveInTx(tx, {
          mazeChecked: true,
          orderId,
          productId: it.productId,
          qty: it.qty,
          eventDate: opts.eventDate,
          pickupDate,
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

/** The number an order's texts go to (Abraham, Nov 25, 2026): the order's own text number, else the customer's phone. */
export function orderTextPhone(order: { textPhone?: string | null }, customer: { phone?: string | null } | null | undefined): string | null {
  return order.textPhone || customer?.phone || null;
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

export async function setOrderStatus(orderId: number, status: OrderStatus, extra: Partial<typeof orders.$inferInsert> = {}, why?: { reason: string; userId?: number | null }) {
  await db
    .update(orders)
    .set({ status, updatedAt: new Date(), ...extra })
    .where(eq(orders.id, orderId));
  if (why) await (await import("@/lib/status-history")).explainStatus(orderId, status, why.reason, why.userId ?? null);
  // Equipment units (Abraham, Nov 15, 2026): a confirmed booking gets its units; a cancelled one gives them back
  if (status === "CONFIRMED") await (await import("@/lib/units")).assignUnits(orderId);
  if (status === "CANCELLED") await (await import("@/lib/units")).releaseUnits(orderId);
}

/** Empty a held cart (keeps the order row as CANCELLED for the call log). */
export async function cancelHold(orderId: number, reason = "Cart emptied (the caller hung up or left the cart)") {
  const res = await db
    .update(orders)
    .set({ status: "CANCELLED", holdExpiresAt: null, updatedAt: new Date(), notes: sql`COALESCE(${orders.notes}, '') || 'Hold released. '` })
    .where(and(eq(orders.id, orderId), eq(orders.status, "HOLD")))
    .returning({ id: orders.id });
  if (res.length) await (await import("@/lib/status-history")).explainStatus(orderId, "CANCELLED", reason);
}

/** Release every hold/payment-pending order whose time ran out. Returns count. */
export async function releaseExpired(): Promise<number> {
  const res = await db
    .update(orders)
    .set({ status: "CANCELLED", updatedAt: new Date(), notes: sql`COALESCE(${orders.notes}, '') || 'Expired hold released. '` })
    .where(and(inArray(orders.status, ["HOLD", "PENDING_PAYMENT"]), lt(orders.holdExpiresAt, new Date())))
    .returning({ id: orders.id });
  if (res.length) {
    const { explainStatus } = await import("@/lib/status-history");
    for (const r of res) await explainStatus(r.id, "CANCELLED", "Hold ended: the time ran out before payment");
  }
  return res.length;
}

/** Mark an order paid (from Sola webhook or manual entry). Idempotent. */
export async function markPaid(orderId: number, cents: number, method: string, ref?: string | null) {
  const [o] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!o) return null;
  if (ref && o.solaRefNum === ref) return o; // duplicate webhook
  const paid = o.paidCents + cents;
  // Late payment (Abraham, Nov 13, 2026): the hold had already ended. Still free: confirm. Taken: never confirm.
  const { handleLatePayment, holdEnded, itemsStillFree } = await import("@/lib/late-payment");
  const late = holdEnded(o);
  const stillFree = late ? await itemsStillFree(orderId) : true;
  // Audit C1 (Nov 24, 2026): confirmed only when paid in full; less than the total needs staff attention
  const owed = o.totalCents ?? o.subtotalCents;
  const short = paid < owed;
  const waiting = o.status === "PENDING_PAYMENT" || o.status === "HOLD" || o.status === "CANCELLED";
  const status: OrderStatus = late && !stillFree ? "NEEDS_ATTENTION" : waiting ? (short ? "NEEDS_ATTENTION" : "CONFIRMED") : o.status;
  const shortNote = waiting && short ? `Paid $${(paid / 100).toFixed(2)} of $${(owed / 100).toFixed(2)}. ` : "";
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
        late || shortNote
          ? sql`COALESCE(${orders.notes}, '') || ${(late ? (stillFree && !short ? "Payment arrived after the hold ended; the items were still free, confirmed. " : stillFree ? "Payment arrived after the hold ended. " : "Payment arrived after the hold ended; the items were taken, needs staff attention. ") : "") + shortNote}`
          : o.notes,
    })
    .where(eq(orders.id, orderId))
    .returning();
  if (late) await handleLatePayment(orderId, cents, method, stillFree);
  if (status !== o.status) {
    const paidText = `Paid $${(cents / 100).toFixed(2)} by ${method}`;
    const why = shortNote ? `${paidText}: ${shortNote.trim()}` : paidText;
    await (await import("@/lib/status-history")).explainStatus(orderId, status, late ? (stillFree ? `${why} after the hold ended; the items were still free` : `${why} after the hold ended; the items were taken by another booking`) : why);
  }
  // Less than the total (Audit C1): the Owner is emailed; the payment record is kept
  if (shortNote) await underpaidAlert(orderId, paid, owed, method, ref ?? null).catch((e) => console.error("[underpaid alert]", e));
  if (updated?.status === "CONFIRMED") await (await import("@/lib/units")).assignUnits(orderId);
  // Bookkeeping (Abraham T): every paid booking is recorded as income automatically (rental, delivery, tax, tip).
  const { recordBookingPayment } = await import("@/lib/books");
  await recordBookingPayment(orderId, cents, method, ref);
  return updated;
}

/**
 * Before a held phone cart becomes PENDING_PAYMENT (Audit C2, Nov 24, 2026): one locked transaction that re-checks
 * every line, the same locks as reserveInTx (stock group, then product, in id order). The cart's own holds are taken out
 * of the count, then put back day by day, so an expired hold whose unit someone else booked is caught. A taken line is
 * removed from the cart (never charged); the taken lines are returned. Holds that pass are renewed.
 */
export async function recheckHolds(orderIds: number[]): Promise<{ orderId: number; productId: number; eventDate: string; qty: number }[]> {
  if (!orderIds.length) return [];
  return db.transaction(async (tx) => {
    const ords = (await tx.select().from(orders).where(and(inArray(orders.id, orderIds), eq(orders.status, "HOLD")))).sort((a, b) => a.eventDate.localeCompare(b.eventDate) || a.id - b.id);
    if (!ords.length) return [];
    const lines = await tx.select().from(orderItems).where(inArray(orderItems.orderId, ords.map((o) => o.id)));
    for (const pid of [...new Set(lines.map((l) => l.productId))].sort((a, b) => a - b)) {
      await tx.execute(sql`SELECT id FROM products WHERE stock_group = (SELECT stock_group FROM products WHERE id = ${pid}) ORDER BY id FOR UPDATE`);
      await tx.execute(sql`SELECT id FROM products WHERE id = ${pid} FOR UPDATE`);
    }
    // Out of the count while checked (now() is the transaction's start time)
    await tx.update(orders).set({ holdExpiresAt: sql`now() - interval '1 second'` }).where(inArray(orders.id, ords.map((o) => o.id)));
    const taken: { orderId: number; productId: number; eventDate: string; qty: number }[] = [];
    for (const o of ords) {
      let removed = false;
      for (const l of lines.filter((x) => x.orderId === o.id).sort((a, b) => a.productId - b.productId)) {
        const [p] = await tx.select({ quantity: products.quantity }).from(products).where(eq(products.id, l.productId));
        const free = p ? await checkBookable(l.productId, p.quantity, o.eventDate, tx, o.pickupDate) : 0;
        if (free < l.qty) {
          taken.push({ orderId: o.id, productId: l.productId, eventDate: o.eventDate, qty: l.qty });
          await tx.delete(orderItems).where(eq(orderItems.id, l.id));
          removed = true;
        }
      }
      if (removed) await recalcSubtotal(tx, o.id);
      // Back in the count before the next day is checked
      await tx.update(orders).set({ holdExpiresAt: minutesFromNow(PHONE_HOLD_MINUTES) }).where(eq(orders.id, o.id));
    }
    return taken;
  });
}

/** Keeps every day of the caller's cart held while they keep going (Audit C2): only holds still active are renewed. */
export async function keepCartHeld(orderIds: number[], opts: { keyPressed?: boolean } = {}) {
  if (!orderIds.length) return;
  // Box 30 (Abraham, Nov 24, 2026): while the caller presses keys the cart never runs out, so a key press renews the
  // hold even if its time just passed (as long as it was not released yet); any other step renews only active holds
  await db
    .update(orders)
    .set({ holdExpiresAt: minutesFromNow(PHONE_HOLD_MINUTES) })
    .where(and(inArray(orders.id, orderIds), eq(orders.status, "HOLD"), ...(opts.keyPressed ? [] : [sql`${orders.holdExpiresAt} > now()`])));
}

/** Owner email: a payment for less than the order's total (Audit C1, Nov 24, 2026). */
async function underpaidAlert(orderId: number, paidCents: number, owedCents: number, method: string, ref: string | null) {
  const { config, BUSINESS_NAME } = await import("@/lib/config");
  const to = config.adminEmail();
  if (!to) return;
  const { sendEmail } = await import("@/lib/notify");
  const n = orderNumber(orderId);
  await sendEmail(
    to,
    `${BUSINESS_NAME}: order #${n} paid less than the total`,
    [`Order #${n} received a payment, but the total paid is $${(paidCents / 100).toFixed(2)} of $${(owedCents / 100).toFixed(2)}.`, `Method: ${method}${ref ? `, reference ${ref}` : ""}.`, "", "The order was NOT confirmed. It is marked Needs attention.", `${config.baseUrl()}${orderPath(orderId)}`].join("\n"),
  );
}

type FullOrder = NonNullable<Awaited<ReturnType<typeof getOrderWithItems>>>;
const dueOf = (o: FullOrder["order"]) => Math.max(0, (o.totalCents ?? o.subtotalCents) - o.paidCents);

/**
 * Orders paid together with one charge (several rental days booked on one call; Abraham, Nov 8, 2026).
 * A single order is its own group. `due` counts only orders still waiting for payment.
 */
export async function getPaymentGroup(orderId: number): Promise<{ primary: FullOrder; orders: FullOrder[]; due: number } | null> {
  const first = await getOrderWithItems(orderId);
  if (!first) return null;
  const gid = first.order.paymentGroupId;
  if (!gid) return { primary: first, orders: [first], due: first.order.status === "PENDING_PAYMENT" ? dueOf(first.order) : 0 };
  const rows = await db.select({ id: orders.id }).from(orders).where(eq(orders.paymentGroupId, gid));
  const list = (await Promise.all(rows.map((r) => getOrderWithItems(r.id)))).filter((x): x is FullOrder => Boolean(x));
  list.sort((a, b) => a.order.eventDate.localeCompare(b.order.eventDate) || a.order.id - b.order.id);
  const primary = list.find((x) => x.order.id === gid) ?? first;
  return { primary, orders: list, due: list.filter((x) => x.order.status === "PENDING_PAYMENT").reduce((n, x) => n + dueOf(x.order), 0) };
}

/**
 * One payment for a group: each order gets its own amount due (primary first), any remainder goes to the last one.
 * Idempotent: a repeated Sola notice (same reference) changes nothing. Returns the orders that were updated.
 */
export async function markGroupPaid(orderId: number, cents: number, method: string, ref?: string | null) {
  const group = await getPaymentGroup(orderId);
  if (!group) return [];
  if (group.orders.length === 1) {
    const one = await markPaid(orderId, cents, method, ref);
    return one ? [one] : [];
  }
  if (ref && group.primary.order.solaRefNum === ref) return []; // duplicate webhook
  const ordered = [group.primary, ...group.orders.filter((x) => x.order.id !== group.primary.order.id)];
  let remaining = cents;
  const out = [];
  for (let i = 0; i < ordered.length; i++) {
    const o = ordered[i].order;
    const pay = i === ordered.length - 1 ? remaining : Math.min(remaining, dueOf(o));
    remaining -= pay;
    const u = await markPaid(o.id, pay, method, ref);
    if (u) out.push(u);
  }
  return out;
}
