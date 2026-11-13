import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { checkBookable } from "@/lib/availability";

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
 * The new customer wording is a draft: this runs on preview only until Abraham approves it (LINK_WORDING_APPROVED).
 */
export const LINK_WORDING_APPROVED = false;
export const IDLE_MINUTES = 4;
export const CARD_MINUTES = 10;

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

/** Draft wording (Abraham approves before it goes live). */
export const LINK_TEXT = {
  expiredTitle: "This payment link has expired",
  expiredBody: (n: number) =>
    `No worries! Your ${n === 1 ? "item was" : "items were"} held for a short time and then went back into stock so other customers could book. Tap below and we'll check if ${n === 1 ? "it's" : "they're"} still free for your date.`,
  checkButton: "Check availability again",
  heldAgain: (min: number) => `Good news, it's still available! We're holding it for you for the next ${min} minutes. Take your time and pay below whenever you're ready.`,
  gone: (n: number) => `Sorry, ${n === 1 ? "this item is" : "these items are"} no longer available for your date.`,
  goneCall: "Please call us at (845) 777-7585, and we'll gladly help you choose another option or another day.",
  cardNote: `After you tap "Agree and pay", you'll have ${CARD_MINUTES} minutes to enter your card on our secure payment page. If time runs out, your rentals simply go back into stock, and you can check availability again and book anytime.`,
};

