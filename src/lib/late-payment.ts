import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { lockStock } from "@/lib/stock-lock";
import { db, schema } from "@/lib/db";
import { checkBookable, getUsage, pickupDateFor, usedOn, lastHeldDay } from "@/lib/availability";
import { addDays, todayISO } from "@/lib/dates";
import { nearbyDays, nearestSize } from "@/lib/alternatives";
import { nextOpenDay } from "@/lib/jewish-calendar";
import { getSettings, linkHoldMinutes } from "@/lib/settings";
import { ensurePriced } from "@/lib/order-pricing";
import { config } from "@/lib/config";
import { sendEmail } from "@/lib/notify";
import { orderPath } from "@/lib/order-path";

/*
 * Payment links and late payments (Abraham, Nov 13, 2026).
 *
 * The link rule (Abraham, Nov 17, 2026, replacing the earlier one):
 *  - A link holds the rentals 10 minutes after it is sent from the phone (25 after an Admin New booking).
 *  - If the customer opened the link, 4 more minutes when that time runs out (once), then the items are released.
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

/**
 * The payment link has expired (deep check Nov 27 #3): a day whose hold ran out. A day staff cancelled on purpose does
 * not count (it is never brought back, A2), so the customer can still pay for the other days.
 */
export async function linkExpired(days: { order: HoldFields & { id: number }; items?: unknown[] }[], now = new Date()): Promise<boolean> {
  const { cancelledByStaff } = await import("@/lib/orders");
  for (const d of days) {
    // Code audit H5: a day emptied by "Check availability again" (every item taken) has nothing to hold again
    if (d.order.status === "CANCELLED" && Array.isArray(d.items) && d.items.length === 0) continue;
    if (holdEnded(d.order, now) && !(d.order.status === "CANCELLED" && (await cancelledByStaff(d.order.id)))) return true;
  }
  return false;
}

/**
 * The customer opened the payment link (Abraham, Nov 17, 2026): 4 more minutes added to the hold, once per link sent
 * (never revives an ended hold). Opening it again, or pressing "Agree and pay", adds nothing more.
 */
export async function keepHoldWhileActive(orderIds: number[], now = new Date()) {
  if (!orderIds.length) return;
  await db
    .update(schema.orders)
    .set({ linkOpenedAt: now, holdExpiresAt: sql`${schema.orders.holdExpiresAt} + interval '${sql.raw(String(IDLE_MINUTES))} minutes'` })
    .where(and(inArray(schema.orders.id, orderIds), eq(schema.orders.status, "PENDING_PAYMENT"), gt(schema.orders.holdExpiresAt, now), isNull(schema.orders.linkOpenedAt)));
}

/** "Agree and pay" pressed, or straight to the card page: the same one-time 4 minutes as opening the link. */
export async function holdForCardPage(orderIds: number[], now = new Date()) {
  return keepHoldWhileActive(orderIds, now);
}

/**
 * "Check availability again" (Abraham, Nov 13, 2026): every item that's still free is held again; any item someone
 * else booked is taken out of the order and listed (linkRemoved) so the customer can pick the nearest option for it.
 * Runs in one transaction with the products locked, so the phone line, another link or Admin can't take the items at
 * the same moment. `primaryId` is the order the link opens; the removed items are kept on it.
 */
export async function holdAgain(orderIds: number[], primaryId = orderIds[0], now = new Date()): Promise<{ held: number[]; removed: number }> {
  // The Admin hold settings (handoff, Nov 26, 2026: "Check availability again" used fixed 25 and 10 minutes; the
  // settings' defaults are the same 25 and 10, so nothing changes until the Owner changes them)
  const { linkHoldMinutes } = await import("@/lib/settings");
  const holdFor = { admin: await linkHoldMinutes("admin"), phone: await linkHoldMinutes("phone") };
  // read before the transaction (one connection in tests; nothing outside it may wait on it)
  const cal = await getSettings();
  const { recheckOrderLines } = await import("@/lib/recheck-lines");
  // Hark's website list A2 (Nov 26, 2026): an order staff cancelled in Admin is never brought back by the link
  const { cancelledByStaff } = await import("@/lib/orders");
  const staffCancelled = new Set<number>();
  for (const id of orderIds) if (await cancelledByStaff(id)) staffCancelled.add(id);
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(schema.orders).where(inArray(schema.orders.id, orderIds));
    const ended = rows.filter((o) => holdEnded(o, now) && !staffCancelled.has(o.id));
    if (!ended.length) return { held: rows.map((o) => o.id), removed: 0 }; // still held (or cancelled by staff): nothing to do
    const items = await tx.select().from(schema.orderItems).where(inArray(schema.orderItems.orderId, ended.map((o) => o.id)));
    const pids = [...new Set(items.map((i) => i.productId))].sort((a, b) => a - b);
    // Code audit L9 (Nov 24, 2026): items sharing one unit (the maze group) are locked as a whole group first, in id
    // order, like a phone booking, so a late payment and a new booking can never both take the shared unit
    await lockStock(tx, pids); // K2 (deep check 06:00 M48): items, groups and laser pools, one id-ordered step
    const removed: { productId: number; qty: number; eventDate: string; name: string }[] = [];
    const today = todayISO(now);
    for (const o of ended) {
      // the order counts again first, so its items are checked together, one after another (Hark's website list A1:
      // two items sharing the maze or a laser pool can't both pass when only one is free)
      await tx.update(schema.orders).set({ status: "PENDING_PAYMENT", holdExpiresAt: inMinutes(holdFor[linkHoldKindOf(o)], now) }).where(eq(schema.orders.id, o.id));
      // Hark's website list A3: a day that has passed, or a phone booking on a day we are closed, is never held again
      const badDay = o.eventDate < today || (linkHoldKindOf(o) === "phone" && nextOpenDay(o.eventDate, cal) !== o.eventDate);
      const gone = badDay ? items.filter((x) => x.orderId === o.id) : await recheckOrderLines(tx, o);
      if (badDay) await tx.delete(schema.orderItems).where(eq(schema.orderItems.orderId, o.id));
      for (const i of gone) {
        const [p] = await tx.select({ name: schema.products.name }).from(schema.products).where(eq(schema.products.id, i.productId)).limit(1);
        removed.push({ productId: i.productId, qty: i.qty, eventDate: o.eventDate, name: p?.name ?? "Item" });
      }
      await tx
        .update(schema.orders)
        .set({
          subtotalCents: sql`COALESCE((SELECT SUM(qty * unit_price_cents) FROM order_items WHERE order_id = ${o.id}), 0)`,
          totalCents: null, // re-priced below
          updatedAt: now,
        })
        .where(eq(schema.orders.id, o.id));
      // Code audit H5 (Nov 24, 2026): every item was taken, so nothing is left to pay for. The day is cancelled (never
      // waiting for payment with only delivery and tax on it); the removed items stay listed for the options.
      const [left] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.orderItems).where(eq(schema.orderItems.orderId, o.id));
      const [svc] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.orderServices).where(eq(schema.orderServices.orderId, o.id));
      if (!left?.n && !svc?.n)
        await tx
          .update(schema.orders)
          .set({ status: "CANCELLED", holdExpiresAt: null, deliveryFeeCents: 0, taxCents: 0, totalCents: 0, notes: sql`COALESCE(${schema.orders.notes}, '') || ${"All items were taken by other bookings after the link expired; nothing left to pay. "}` })
          .where(eq(schema.orders.id, o.id));
    }
    if (removed.length) {
      const [primary] = await tx.select().from(schema.orders).where(eq(schema.orders.id, primaryId)).limit(1);
      await tx.update(schema.orders).set({ linkRemoved: [...(primary?.linkRemoved ?? []), ...removed] }).where(eq(schema.orders.id, primaryId));
    }
    return { held: rows.map((o) => o.id), removed: removed.length };
  }).then(async (r) => {
    // an emptied day (H5) is cancelled above and is not priced again
    for (const id of orderIds) {
      const [o] = await db.select({ status: schema.orders.status }).from(schema.orders).where(eq(schema.orders.id, id)).limit(1);
      if (o?.status !== "CANCELLED") await ensurePriced(id);
    }
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
  // Abraham's wording, Nov 18, 2026 (approved; replaces the Nov 13 note): 10 minutes from the text, plus 4 once opened
  // Abraham, Nov 26, 2026, 14:04 ("Go ahead, fix it"): the same approved words with this link's own hold minutes
  // (phone-sent links: the phone hold, 10; staff and Admin links: the Admin hold, 25), never a fixed number
  cardNote: (min: number) => `This link holds your booking for ${min} minutes. Once you open it, you get 4 more minutes to pay.`,
};

/** Which hold this order's payment link has: the one that sent it, else by how it was booked. */
export function linkHoldKindOf(o: { linkHoldKind?: string | null; channel?: string | null }): "phone" | "admin" {
  if (o.linkHoldKind === "phone" || o.linkHoldKind === "admin") return o.linkHoldKind;
  return o.channel === "POS" ? "admin" : "phone"; // as before: New booking 25, everything else the phone hold
}


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
  // The Admin hold settings (Hark's review H7, Nov 26, 2026): not fixed 25 and 10 minutes
  const holdFor = { phone: await linkHoldMinutes("phone"), admin: await linkHoldMinutes("admin") };
  // Hark's website list A2 (Nov 26, 2026): an order staff cancelled in Admin is never brought back by the link
  const { cancelledByStaff } = await import("@/lib/orders");
  if (await cancelledByStaff(primaryId)) return false;
  // Hark's website list A3: never a day that has passed
  if (date < todayISO(now)) return false;
  const ok = await db.transaction(async (tx) => {
    // the whole unit group (maze, laser pools) is locked, as for a phone booking
    await lockStock(tx, [productId]); // K2: with the laser pools too
    const [p] = await tx.select().from(schema.products).where(eq(schema.products.id, productId)).limit(1);
    const [primary] = await tx.select().from(schema.orders).where(eq(schema.orders.id, primaryId)).limit(1);
    if (!p?.active || !primary) return false;
    const holdMin = holdFor[linkHoldKindOf(primary)]; // the hold of the link that was sent (Nov 26, 2026)
    if ((await checkBookable(p.id, p.quantity, date, tx, pickup)) < entry.qty) return false;
    const groupIds = primary.paymentGroupId
      ? (await tx.select({ id: schema.orders.id }).from(schema.orders).where(eq(schema.orders.paymentGroupId, primary.paymentGroupId))).map((r) => r.id)
      : [primary.id];
    const group = await tx.select().from(schema.orders).where(inArray(schema.orders.id, groupIds));
    const counts = async (id: number) => (await tx.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, id))).length;
    // 1. an order of this payment for that day; 2. the removed item's own order if it has nothing left; 3. a new one
    let target = group.find((g) => g.eventDate === date && g.status === "PENDING_PAYMENT");
    // Deep check 09:00 P4: that day's hold has ended (its other items no longer counted, someone may have booked them):
    // never held again here unchecked; "Check availability again" checks the whole day first
    if (target && holdEnded(target, now)) return false;
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
        .values({ status: "PENDING_PAYMENT", channel: primary.channel, eventDate: date, pickupDate: pickup, customerId: primary.customerId, deliveryAddress: primary.deliveryAddress, paymentGroupId: gid, holdExpiresAt: inMinutes(holdMin, now), callSid: primary.callSid })
        .returning();
      target = created;
    }
    // Deep check 06:00 M52: laser sets are saved one line per set (as the phone and New booking save them), so every
    // third set's half price and the delivery item count work the same; other items keep one line with the quantity
    const [cat] = p.categoryId ? await tx.select({ name: schema.categories.name }).from(schema.categories).where(eq(schema.categories.id, p.categoryId)).limit(1) : [];
    if (/laser/i.test(cat?.name ?? "")) {
      for (let n = 0; n < entry.qty; n++) await tx.insert(schema.orderItems).values({ orderId: target.id, productId: p.id, qty: 1, unitPriceCents: p.priceCents });
    } else {
      const [same] = await tx.select().from(schema.orderItems).where(and(eq(schema.orderItems.orderId, target.id), eq(schema.orderItems.productId, p.id)));
      if (same) await tx.update(schema.orderItems).set({ qty: same.qty + entry.qty }).where(eq(schema.orderItems.id, same.id));
      else await tx.insert(schema.orderItems).values({ orderId: target.id, productId: p.id, qty: entry.qty, unitPriceCents: p.priceCents });
    }
    await tx
      .update(schema.orders)
      .set({
        status: "PENDING_PAYMENT",
        holdExpiresAt: inMinutes(holdMin, now),
        subtotalCents: sql`COALESCE((SELECT SUM(qty * unit_price_cents) FROM order_items WHERE order_id = ${target.id}), 0)`,
        totalCents: null,
        updatedAt: now,
        notes: sql`COALESCE(${schema.orders.notes}, '') || ${`Chose ${p.name} on ${date} on the payment link (instead of ${entry.name} on ${entry.eventDate}). `}`,
      })
      .where(eq(schema.orders.id, target.id));
    const left = (primary.linkRemoved ?? []).filter((_, i) => i !== index);
    await tx.update(schema.orders).set({ linkRemoved: left }).where(eq(schema.orders.id, primaryId));
    touched.add(target.id);
    // Deep check Nov 27 #12: one delivery charge per booking. The booking's days still waiting with nothing paid are
    // priced again together, so a new (or earlier) first day carries the one charge and the old first day loses it
    const gidNow = target.paymentGroupId ?? primary.paymentGroupId;
    if (gidNow) {
      const again = await tx
        .update(schema.orders)
        .set({ totalCents: null })
        .where(and(eq(schema.orders.paymentGroupId, gidNow), eq(schema.orders.status, "PENDING_PAYMENT"), eq(schema.orders.paidCents, 0)))
        .returning({ id: schema.orders.id });
      for (const r of again) touched.add(r.id);
    }
    return true;
  });
  // in date order, so the first day is priced (and takes the delivery charge) with every day of the booking known
  const touchedRows = touched.size ? await db.select({ id: schema.orders.id, d: schema.orders.eventDate }).from(schema.orders).where(inArray(schema.orders.id, [...touched])) : [];
  for (const r of touchedRows.sort((a, b) => a.d.localeCompare(b.d) || a.id - b.id)) await ensurePriced(r.id);
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

/**
 * A late payment's stock check (deep check Nov 27 #4), the same as "Check availability again" (A1): the whole order is
 * checked as one in a locked transaction (stock group, then product, in id order), so two items sharing one unit (maze,
 * laser pools) can never both pass when only one is free. When it fits, the order counts again right away (a short hold)
 * so nobody can take the units before the payment confirms it; when it does not, nothing changes.
 */
export async function claimIfStillFree(orderId: number, now = new Date()): Promise<boolean> {
  const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
  if (!o) return false;
  const { assertOrderFits, withFitCheck } = await import("@/lib/recheck-lines");
  return withFitCheck(db, async (tx) => {
    const lines = await tx.select({ productId: schema.orderItems.productId }).from(schema.orderItems).where(eq(schema.orderItems.orderId, orderId));
    const pids = [...new Set(lines.map((l) => l.productId))].sort((a, b) => a - b);
    await lockStock(tx, pids); // K2 (deep check 06:00 M48): items, groups and laser pools, one id-ordered step
    if (!lines.length) return true;
    // the order counts while its lines are checked one after another
    await tx.update(schema.orders).set({ status: "PENDING_PAYMENT", holdExpiresAt: inMinutes(IDLE_MINUTES, now) }).where(eq(schema.orders.id, orderId));
    await assertOrderFits(tx, o);
    return true;
  });
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
        `\n\n${config.baseUrl()}${orderPath(orderId)}`,
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
  // Nov 24, 2026: the order holds its units from the event day through the day before pickup
  const last = lastHeldDay(o.eventDate, o.pickupDate);
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
  const { assertOrderFits, withFitCheck } = await import("@/lib/recheck-lines");
  const ok = await withFitCheck(db, async (tx) => {
    const [o] = await tx.select().from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
    if (!o || o.status !== "NEEDS_ATTENTION") return false;
    const items = await tx.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, orderId));
    // the items and their shared groups locked in id order, like a phone booking
    await lockStock(tx, items.map((i) => i.productId)); // K2: items, groups and laser pools, one id-ordered step
    // Hark's Admin list 4 and 12 (Nov 26, 2026): the whole order is checked (the maze group and laser pools too)
    await assertOrderFits(tx, o);
    await tx.update(schema.orders).set({ status: "CONFIRMED", holdExpiresAt: null, updatedAt: new Date() }).where(eq(schema.orders.id, orderId));
    return true;
  });
  // Admin list 12: a confirmed order gets its units (as New booking does)
  if (ok) await (await import("@/lib/units")).assignUnits(orderId, { quiet: true }).catch(() => undefined);
  return ok;
}
