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
 * "Check availability again": hold the same order again if every item is still free on every day. Runs in one
 * transaction with the products locked, so the phone line, another link or Admin can't take the items at the same
 * moment. Returns the order ids that were held again, or null when something is no longer free.
 */
export async function holdAgain(orderIds: number[], now = new Date()): Promise<number[] | null> {
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(schema.orders).where(inArray(schema.orders.id, orderIds));
    const ended = rows.filter((o) => holdEnded(o, now));
    if (!ended.length) return rows.map((o) => o.id); // still held: nothing to do
    const items = await tx.select().from(schema.orderItems).where(inArray(schema.orderItems.orderId, ended.map((o) => o.id)));
    const pids = [...new Set(items.map((i) => i.productId))].sort((a, b) => a - b);
    for (const id of pids) await tx.execute(sql`SELECT id FROM products WHERE id = ${id} FOR UPDATE`);
    for (const o of ended) {
      for (const i of items.filter((x) => x.orderId === o.id)) {
        const [p] = await tx.select().from(schema.products).where(eq(schema.products.id, i.productId)).limit(1);
        if (!p?.active) return null;
        const free = await checkBookable(p.id, p.quantity, o.eventDate, tx, o.pickupDate);
        if (free < i.qty) return null;
      }
    }
    for (const o of ended) {
      await tx
        .update(schema.orders)
        .set({ status: "PENDING_PAYMENT", holdExpiresAt: inMinutes(o.channel === "POS" ? 25 : 10, now), updatedAt: now })
        .where(eq(schema.orders.id, o.id));
    }
    return rows.map((o) => o.id);
  });
}

/** The link page wording, approved by Abraham (Nov 13, 2026). */
export const LINK_TEXT = {
  expiredTitle: "This payment link has expired",
  // Abraham's wording, Nov 13, 2026 (approved)
  expiredBody: (n: number) =>
    n === 1
      ? "Your item was back into stock so other customers could book. Tap below to check if it's still free for your date."
      : "Your items were back into stock so other customers could book. Tap below to check if they're still free for your date.",
  checkButton: "Check availability again",
  // Abraham's wording, Nov 13, 2026 (approved): 10 minutes for a phone order, 25 for an Admin link
  heldAgain: (min: number) => `It's still available! We're holding it for you for the next ${min} minutes.`,
  // Abraham's wording, Nov 13, 2026 (approved)
  gone: (n: number) => `${n === 1 ? "This item is" : "These items are"} no longer available for your date.`,
  goneCall: "Please call us at (845) 777-7585, to choose another option or another day.",
  // The nearest options (same as the phone line offers). Abraham's wording, Nov 13, 2026 (approved)
  optionsIntro: "Here are the nearest options that are free for you right now. Tap one to hold it for you:",
  // Abraham's wording, Nov 13, 2026 (approved)
  cardNote: `After you tap "Agree and pay," you will have ${CARD_MINUTES} minutes to enter your card details on our secure payment page. If your session expires, your rented items will be returned to stock, and you can check again availability to rebook at any time.`,
};


export type LinkOption = { kind: "bigger" | "smaller" | "before" | "after"; productId: number; name: string; date: string; priceCents: number };

/**
 * The nearest free options for an expired link whose item is gone, the same ones the phone offers: one size bigger
 * or smaller on the same day, or the same item on the day before / after (else the nearest open days). Only for an
 * order with one item on one day; other orders get the call-us line.
 */
export async function linkOptions(orderIds: number[]): Promise<LinkOption[]> {
  if (orderIds.length !== 1) return [];
  const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderIds[0])).limit(1);
  const items = o ? await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, o.id)) : [];
  if (!o || items.length !== 1) return [];
  const [p] = await db.select().from(schema.products).where(eq(schema.products.id, items[0].productId)).limit(1);
  if (!p) return [];
  const cal = await getSettings();
  const [big, small, days] = await Promise.all([nearestSize(p, o.eventDate, 1, cal), nearestSize(p, o.eventDate, -1, cal), nearbyDays(p, o.eventDate, cal)]);
  const out: LinkOption[] = [];
  if (big) out.push({ kind: "bigger", productId: big.id, name: big.name, date: o.eventDate, priceCents: big.priceCents });
  if (small) out.push({ kind: "smaller", productId: small.id, name: small.name, date: o.eventDate, priceCents: small.priceCents });
  if (days.before) out.push({ kind: "before", productId: p.id, name: p.name, date: days.before, priceCents: p.priceCents });
  if (days.after) out.push({ kind: "after", productId: p.id, name: p.name, date: days.after, priceCents: p.priceCents });
  return out;
}

/**
 * The customer tapped an option: only one the server itself offers is accepted. In one locked transaction the order
 * changes to that item and day, is held again, and is re-priced (items + delivery + tax) before they pay.
 */
export async function chooseLinkOption(orderId: number, productId: number, date: string, now = new Date()): Promise<boolean> {
  const offered = (await linkOptions([orderId])).find((x) => x.productId === productId && x.date === date);
  if (!offered) return false;
  const cal = await getSettings();
  const ok = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM products WHERE id = ${productId} FOR UPDATE`);
    const [p] = await tx.select().from(schema.products).where(eq(schema.products.id, productId)).limit(1);
    const [o] = await tx.select().from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
    if (!p?.active || !o || !holdEnded(o, now)) return false;
    const pickup = pickupDateFor(date, cal);
    if ((await checkBookable(p.id, p.quantity, date, tx, pickup)) < 1) return false;
    const [line] = await tx.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, orderId));
    await tx.update(schema.orderItems).set({ productId: p.id, unitPriceCents: p.priceCents }).where(eq(schema.orderItems.id, line.id));
    await tx
      .update(schema.orders)
      .set({
        eventDate: date,
        pickupDate: pickup,
        status: "PENDING_PAYMENT",
        holdExpiresAt: inMinutes(o.channel === "POS" ? 25 : 10, now),
        subtotalCents: line.qty * p.priceCents,
        totalCents: null, // re-priced below: items + delivery + tax
        updatedAt: now,
        notes: sql`COALESCE(${schema.orders.notes}, '') || ${`Changed on the payment link to ${p.name} on ${date}. `}`,
      })
      .where(eq(schema.orders.id, orderId));
    return true;
  });
  if (ok) await ensurePriced(orderId);
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
