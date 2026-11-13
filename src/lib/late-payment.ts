import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { checkBookable, getUsage, pickupDateFor, usedOn } from "@/lib/availability";
import { addDays } from "@/lib/dates";
import { nearbyDays, nearestSize } from "@/lib/alternatives";
import { getSettings } from "@/lib/settings";
import { ensurePriced } from "@/lib/order-pricing";
import { config } from "@/lib/config";
import { sendEmail } from "@/lib/notify";

/*
 * Payment links and late payments (Abraham, Nov 13, 2026).
 *
 * The link rule:
 *  - A link holds the rentals 10 minutes after a phone booking (25 after an Admin New booking).
 *  - Activity on our payment page (opening it, pressing "Agree and pay") keeps the hold: no activity for 4 minutes
 *    and it ends (opened at minute 9, nothing more: expired at minute 13).
 *  - Pressing "Agree and pay" gives 10 minutes to finish on Sola's card page (Sola can't tell us about typing there).
 *  - After the hold ends the link shows "expired" with a "Check availability again" button: if everything is still
 *    free, the same order is held again (database lock, so no one else can take it) and the customer pays.
 *
 * Only the link is built (Abraham, Nov 13: "Only the link."). The late-payment backup is a separate plan he reviews.
 * Every line is Abraham's approved wording (Nov 13, 2026), so it runs on the live site too (LINK_WORDING_APPROVED).
 */
export const LINK_WORDING_APPROVED = true; // Abraham approved every line of the link page, Nov 13, 2026
export const IDLE_MINUTES = 4;
export const CARD_MINUTES = 10;

/** The nearest-options list: its intro line approved by Abraham (Nov 13, 2026), so it runs on the live site too. */
export const OPTIONS_WORDING_APPROVED = true;
export function linkOptionsActive(env: Record<string, string | undefined> = process.env) {
  return OPTIONS_WORDING_APPROVED || env.VERCEL_ENV !== "production";
}

export function linkRulesActive(env: Record<string, string | undefined> = process.env) {
  return LINK_WORDING_APPROVED || env.VERCEL_ENV !== "production";
}

const inMinutes = (m: number, now = new Date()) => new Date(now.getTime() + m * 60_000);

type HoldFields = { status: string; holdExpiresAt: Date | null; paidCents: number };

/** The hold behind this order ended (released, or past its end time) and nothing was paid. */
export function holdEnded(o: HoldFields, now = new Date()) {
  if (o.status === "CANCELLED") return o.paidCents === 0;
  return (o.status === "PENDING_PAYMENT" || o.status === "HOLD") && Boolean(o.holdExpiresAt && o.holdExpiresAt <= now);
}

/** Activity on our payment page: keep the hold at least 4 more minutes (never revives an ended hold). */
export async function keepHoldWhileActive(orderIds: number[], now = new Date()) {
  if (!orderIds.length) return;
  await db
    .update(schema.orders)
    .set({ holdExpiresAt: sql`GREATEST(${schema.orders.holdExpiresAt}, ${inMinutes(IDLE_MINUTES, now)})` })
    .where(and(inArray(schema.orders.id, orderIds), eq(schema.orders.status, "PENDING_PAYMENT"), gt(schema.orders.holdExpiresAt, now)));
}

/** "Agree and pay" pressed: 10 minutes to finish on the card page. */
export async function holdForCardPage(orderIds: number[], now = new Date()) {
  if (!orderIds.length) return;
  await db
    .update(schema.orders)
    .set({ holdExpiresAt: sql`GREATEST(${schema.orders.holdExpiresAt}, ${inMinutes(CARD_MINUTES, now)})` })
    .where(and(inArray(schema.orders.id, orderIds), eq(schema.orders.status, "PENDING_PAYMENT"), gt(schema.orders.holdExpiresAt, now)));
}

/**
 * "Check availability again" (Abraham, Nov 13, 2026): every item that's still free is held again; any item someone
 * else booked is taken out of the order and listed (linkRemoved) so the customer can pick the nearest option for it.
 * Runs in one transaction with the products locked, so the phone line, another link or Admin can't take the items at
 * the same moment. `primaryId` is the order the link opens; the removed items are kept on it.
 */
export async function holdAgain(orderIds: number[], primaryId = orderIds[0], now = new Date()): Promise<{ held: number[]; removed: number }> {
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(schema.orders).where(inArray(schema.orders.id, orderIds));
    const ended = rows.filter((o) => holdEnded(o, now));
    if (!ended.length) return { held: rows.map((o) => o.id), removed: 0 }; // still held: nothing to do
    const items = await tx.select().from(schema.orderItems).where(inArray(schema.orderItems.orderId, ended.map((o) => o.id)));
    const pids = [...new Set(items.map((i) => i.productId))].sort((a, b) => a - b);
    for (const id of pids) await tx.execute(sql`SELECT id FROM products WHERE id = ${id} FOR UPDATE`);
    const removed: { productId: number; qty: number; eventDate: string; name: string }[] = [];
    for (const o of ended) {
      for (const i of items.filter((x) => x.orderId === o.id)) {
        const [p] = await tx.select().from(schema.products).where(eq(schema.products.id, i.productId)).limit(1);
        const free = p?.active ? await checkBookable(p.id, p.quantity, o.eventDate, tx, o.pickupDate) : 0;
        if (free >= i.qty) continue;
        removed.push({ productId: i.productId, qty: i.qty, eventDate: o.eventDate, name: p?.name ?? "Item" });
        await tx.delete(schema.orderItems).where(eq(schema.orderItems.id, i.id));
      }
      await tx
        .update(schema.orders)
        .set({
          status: "PENDING_PAYMENT",
          holdExpiresAt: inMinutes(o.channel === "POS" ? 25 : 10, now),
          subtotalCents: sql`COALESCE((SELECT SUM(qty * unit_price_cents) FROM order_items WHERE order_id = ${o.id}), 0)`,
          totalCents: null, // re-priced below
          updatedAt: now,
        })
        .where(eq(schema.orders.id, o.id));
    }
    if (removed.length) {
      const [primary] = await tx.select().from(schema.orders).where(eq(schema.orders.id, primaryId)).limit(1);
      await tx.update(schema.orders).set({ linkRemoved: [...(primary?.linkRemoved ?? []), ...removed] }).where(eq(schema.orders.id, primaryId));
    }
    return { held: rows.map((o) => o.id), removed: removed.length };
  }).then(async (r) => {
    for (const id of orderIds) await ensurePriced(id);
    return r;
  });
}

/** The link page wording, approved by Abraham (Nov 13, 2026). */
export const LINK_TEXT = {
  expiredTitle: "This payment link has expired",
  // Abraham's wording, Nov 13, 2026 (approved)
  expiredBody: (n: number) =>
    n === 1
      ? "Your item was back into stock so other customers could book. Tap below to check if it's still free for your date."
      : "Your items were back into stock so other customers could book. Tap below to check if they are still free for your date.",
  checkButton: "Check availability again",
  // Abraham's wording, Nov 13, 2026 (approved): 10 minutes for a phone order, 25 for an Admin link
  heldAgain: (min: number) => `It's still available! We are holding it for you for the next ${min} minutes.`,
  // Abraham's wording, Nov 13, 2026 (approved)
  gone: (n: number) => `${n === 1 ? "This item is" : "These items are"} no longer available for your date.`,
  goneCall: "Please call us at (845) 777-7585, to choose another option or another day.",
  // The nearest options (same as the phone line offers). Abraham's wording, Nov 13, 2026 (approved)
  optionsIntro: "Here are the nearest options that are free for you right now. Tap one to hold it for you:",
  // Abraham's wording, Nov 13, 2026 (approved)
  cardNote: `After you tap "Agree and pay," you will have ${CARD_MINUTES} minutes to enter your card details on our secure payment page. If your session expires, your rented items will be returned to stock, and you can check again availability to rebook at any time.`,
};


export type LinkOption = { kind: "bigger" | "smaller" | "before" | "after"; productId: number; name: string; date: string; priceCents: number };
export type RemovedWithOptions = { index: number; name: string; qty: number; eventDate: string; options: LinkOption[] };

/**
 * For each item taken out of the link: the nearest free options, the same the phone offers (one size bigger or
 * smaller the same day, the same item the day before / after, else the nearest open days).
 */
export async function removedWithOptions(primaryId: number): Promise<RemovedWithOptions[]> {
  const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, primaryId)).limit(1);
  if (!o?.linkRemoved?.length) return [];
  const cal = await getSettings();
  const out: RemovedWithOptions[] = [];
  for (const [index, r] of o.linkRemoved.entries()) {
    const [p] = await db.select().from(schema.products).where(eq(schema.products.id, r.productId)).limit(1);
    const options: LinkOption[] = [];
    if (p) {
      const [big, small, days] = await Promise.all([nearestSize(p, r.eventDate, 1, cal), nearestSize(p, r.eventDate, -1, cal), nearbyDays(p, r.eventDate, cal)]);
      if (big) options.push({ kind: "bigger", productId: big.id, name: big.name, date: r.eventDate, priceCents: big.priceCents });
      if (small) options.push({ kind: "smaller", productId: small.id, name: small.name, date: r.eventDate, priceCents: small.priceCents });
      if (days.before) options.push({ kind: "before", productId: p.id, name: p.name, date: days.before, priceCents: p.priceCents });
      if (days.after) options.push({ kind: "after", productId: p.id, name: p.name, date: days.after, priceCents: p.priceCents });
    }
    out.push({ index, name: r.name, qty: r.qty, eventDate: r.eventDate, options });
  }
  return out;
}

/**
 * The customer tapped an option for one removed item: only an option the server itself offers is accepted. In one
 * locked transaction the item is added to the order for that day (or that order moves to the new day when it has
 * nothing else, or a new order joins the same payment), held again, and everything is re-priced before paying.
 */
export async function chooseLinkOption(primaryId: number, index: number, productId: number, date: string, now = new Date()): Promise<boolean> {
  const entry = (await removedWithOptions(primaryId)).find((r) => r.index === index);
  if (!entry?.options.some((x) => x.productId === productId && x.date === date)) return false;
  const cal = await getSettings();
  const pickup = pickupDateFor(date, cal);
  const touched = new Set<number>();
  const ok = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM products WHERE id = ${productId} FOR UPDATE`);
    const [p] = await tx.select().from(schema.products).where(eq(schema.products.id, productId)).limit(1);
    const [primary] = await tx.select().from(schema.orders).where(eq(schema.orders.id, primaryId)).limit(1);
    if (!p?.active || !primary) return false;
    if ((await checkBookable(p.id, p.quantity, date, tx, pickup)) < entry.qty) return false;
    const groupIds = primary.paymentGroupId
      ? (await tx.select({ id: schema.orders.id }).from(schema.orders).where(eq(schema.orders.paymentGroupId, primary.paymentGroupId))).map((r) => r.id)
      : [primary.id];
    const group = await tx.select().from(schema.orders).where(inArray(schema.orders.id, groupIds));
    const counts = async (id: number) => (await tx.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, id))).length;
    // 1. an order of this payment for that day; 2. the removed item's own order if it has nothing left; 3. a new one
    let target = group.find((g) => g.eventDate === date && g.status === "PENDING_PAYMENT");
    if (!target) {
      const own = group.find((g) => g.eventDate === entry.eventDate);
      if (own && (await counts(own.id)) === 0) {
        await tx.update(schema.orders).set({ eventDate: date, pickupDate: pickup }).where(eq(schema.orders.id, own.id));
        target = { ...own, eventDate: date, pickupDate: pickup };
      }
    }
    if (!target) {
      const gid = primary.paymentGroupId ?? primary.id;
      if (!primary.paymentGroupId) await tx.update(schema.orders).set({ paymentGroupId: gid }).where(eq(schema.orders.id, primary.id));
      const [created] = await tx
        .insert(schema.orders)
        .values({ status: "PENDING_PAYMENT", channel: primary.channel, eventDate: date, pickupDate: pickup, customerId: primary.customerId, deliveryAddress: primary.deliveryAddress, paymentGroupId: gid, holdExpiresAt: inMinutes(primary.channel === "POS" ? 25 : 10, now), callSid: primary.callSid })
        .returning();
      target = created;
    }
    const [same] = await tx.select().from(schema.orderItems).where(and(eq(schema.orderItems.orderId, target.id), eq(schema.orderItems.productId, p.id)));
    if (same) await tx.update(schema.orderItems).set({ qty: same.qty + entry.qty }).where(eq(schema.orderItems.id, same.id));
    else await tx.insert(schema.orderItems).values({ orderId: target.id, productId: p.id, qty: entry.qty, unitPriceCents: p.priceCents });
    await tx
      .update(schema.orders)
      .set({
        status: "PENDING_PAYMENT",
        holdExpiresAt: inMinutes(primary.channel === "POS" ? 25 : 10, now),
        subtotalCents: sql`COALESCE((SELECT SUM(qty * unit_price_cents) FROM order_items WHERE order_id = ${target.id}), 0)`,
        totalCents: null,
        updatedAt: now,
        notes: sql`COALESCE(${schema.orders.notes}, '') || ${`Chose ${p.name} on ${date} on the payment link (instead of ${entry.name} on ${entry.eventDate}). `}`,
      })
      .where(eq(schema.orders.id, target.id));
    const left = (primary.linkRemoved ?? []).filter((_, i) => i !== index);
    await tx.update(schema.orders).set({ linkRemoved: left }).where(eq(schema.orders.id, primaryId));
    touched.add(target.id);
    return true;
  });
  for (const id of touched) await ensurePriced(id);
  return ok;
}

/*
 * Late payment backup (Abraham, Nov 13, 2026: "build it as planned"). Money that arrives after the hold ended:
 *  - items still free: the order confirms by itself, and the Owner gets an email;
 *  - items taken by someone else: "Needs staff attention", never confirmed by itself; the Owner gets an email,
 *    and the customer gets Abraham's email below.
 */
export const LATE_EMAIL_APPROVED = true; // Abraham approved the wording, Nov 13, 2026
export const LATE_EMAIL = {
  subject: (num: string) => `Hup Up Attractions order #${num}: please call us`,
  // Abraham's wording, Nov 13, 2026 (approved), every word spelled out per his rule
  body: (num: string) =>
    `Thank you, we received your payment for order #${num}. Your hold ended just before it went through, so our team needs to check your booking. Please call customer service at (845) 777-7585, extension 3, and we will take care of it. If it is not available anymore, we will give you another option to book.\n\nHup Up Attractions`,
};

/** Are this order's items free on every day it needs (an ended hold isn't counted, so its own row is left out)? */
export async function itemsStillFree(orderId: number): Promise<boolean> {
  const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
  if (!o) return false;
  const items = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, orderId));
  for (const i of items) {
    const [p] = await db.select().from(schema.products).where(eq(schema.products.id, i.productId)).limit(1);
    if (!p || (await checkBookable(p.id, p.quantity, o.eventDate, db, o.pickupDate)) < i.qty) return false;
  }
  return true;
}

/** After a late payment was recorded: the Owner's email, and the customer's when the items were taken. */
export async function handleLatePayment(orderId: number, cents: number, method: string, stillFree: boolean, env: Record<string, string | undefined> = process.env) {
  const { orderNumber, getOrderWithItems } = await import("@/lib/orders");
  const num = orderNumber(orderId);
  const to = config.adminEmail();
  if (to)
    await sendEmail(
      to,
      stillFree ? `Hup Up Attractions: late payment on order #${num} (confirmed)` : `Hup Up Attractions: late payment on order #${num} needs staff attention`,
      `A payment of $${(cents / 100).toFixed(2)} (${method}) arrived after the hold on order #${num} had ended.\n\n` +
        (stillFree
          ? "The items were still free on those days, so the order was confirmed by itself. Nothing else to do."
          : "Some items are no longer free on those days (another customer booked them). The order is not confirmed and is marked Needs staff attention. Please call the customer about another date or item, or a refund.") +
        `\n\n${config.baseUrl()}/admin/orders/${orderId}`,
    ).catch((e) => console.error("[late payment] owner email failed:", e));
  if (!stillFree && (LATE_EMAIL_APPROVED || env.VERCEL_ENV !== "production")) {
    const full = await getOrderWithItems(orderId);
    if (full?.customer?.email) await sendEmail(full.customer.email, LATE_EMAIL.subject(num), LATE_EMAIL.body(num)).catch(() => null);
  }
}

/**
 * For a "Needs staff attention" order (its own claim counts while it waits): are its items free again, meaning no
 * day is booked past the stock with this order included?
 */
export async function attentionItemsFree(orderId: number, exec: Pick<typeof db, "execute" | "select"> = db): Promise<boolean> {
  const [o] = await exec.select().from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
  if (!o) return false;
  const items = await exec.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, orderId));
  const last = o.pickupDate && o.pickupDate > o.eventDate ? o.pickupDate : o.eventDate;
  const usage = await getUsage(o.eventDate, last, items.map((i) => i.productId), exec);
  for (const i of items) {
    const [p] = await exec.select().from(schema.products).where(eq(schema.products.id, i.productId)).limit(1);
    if (!p) return false;
    for (let d = o.eventDate; d <= last; d = addDays(d, 1)) if (usedOn(usage, i.productId, d) > p.quantity) return false;
  }
  return true;
}

/** Staff confirm a "Needs staff attention" order once its items are free again (checked here, with the stock locked). */
export async function confirmAttentionOrder(orderId: number): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [o] = await tx.select().from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
    if (!o || o.status !== "NEEDS_ATTENTION") return false;
    const items = await tx.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, orderId));
    for (const id of [...new Set(items.map((i) => i.productId))].sort((a, b) => a - b)) await tx.execute(sql`SELECT id FROM products WHERE id = ${id} FOR UPDATE`);
    if (!(await attentionItemsFree(orderId, tx))) return false;
    await tx.update(schema.orders).set({ status: "CONFIRMED", updatedAt: new Date() }).where(eq(schema.orders.id, orderId));
    return true;
  });
}
