import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { priceOrder } from "@/lib/pricing";

/**
 * Every payment link charges items + delivery + tax (Abraham, Nov 12, 2026). Phone orders are priced at checkout;
 * orders made in Admin (New booking) and older orders get priced here, from their delivery address, before a link
 * is made. Already-priced orders are left as they are. Returns false when the address isn't in the delivery area
 * (or there is none), so no link goes out for the items alone.
 */
/**
 * Delivery and sales tax on a rentals total (Nov 24, 2026: one place, used by saved orders and the booking screen's
 * live total, so the screen, the payment link, the text and the order page match to the cent). Null = no price.
 */
export async function totalsFor(subtotalCents: number, offerNote: string | null, address: string | null | undefined, eventDate: string, s: Awaited<ReturnType<typeof getSettings>>, itemCount = 1) {
  let t = await priceOrder(subtotalCents, address, s, undefined, eventDate);
  if (!t) return null;
  // Abraham, Nov 27, 2026, 1:06 AM: the zone price is for the first item; each more item adds the Admin amount
  {
    const { bookingDeliveryCents } = await import("@/lib/delivery-rule");
    const { totalsWithFee } = await import("@/lib/pricing");
    if (itemCount > 1) t = totalsWithFee(subtotalCents, t.zone, bookingDeliveryCents(t.deliveryFeeCents, itemCount, s), s);
  }
  // A free 4th Sunday pays its own delivery ($20 / $30 / $40)
  const { OFFER_NOTES } = await import("@/lib/offers");
  if (offerNote === OFFER_NOTES.fourthSunday) {
    const { deliveryQuote } = await import("@/lib/delivery-areas");
    const { deliveryFeeFor } = await import("@/lib/offer-delivery");
    const { totalsWithFee } = await import("@/lib/pricing");
    const q = await deliveryQuote(address, s, undefined, eventDate);
    const { bookingDeliveryCents } = await import("@/lib/delivery-rule");
    if (q.ok && q.kind) t = totalsWithFee(subtotalCents, q.zone, bookingDeliveryCents(deliveryFeeFor(q.kind, s, eventDate, offerNote), itemCount, s), s);
  }
  return t;
}

/** Why an address has no delivery price, in words for staff; null = it can be priced. */
export async function addressProblem(address: string | null | undefined, s: Awaited<ReturnType<typeof getSettings>>, eventDate?: string): Promise<string | null> {
  const { deliveryQuote, spellingHint } = await import("@/lib/delivery-areas");
  const q = await deliveryQuote(address, s, undefined, eventDate ?? new Date());
  if (q.ok) return null;
  if (q.reason === "outside") return "We don't deliver to this address: the house is outside every zone on the delivery price map.";
  if (q.reason === "no_address") return "Add the delivery address first (house number, street, town and ZIP).";
  if (q.reason === "no_price") return "This zone has no price yet. Ask the Owner to set it in Delivery settings.";
  const hint = address ? spellingHint(address, s.localStreets) : null;
  return `This address could not be found on the map. Check the spelling of the house number, street, town and ZIP${hint ? ` (did you mean ${hint}?)` : ""}, fix it on the order, and try again.`;
}

export async function ensurePriced(orderId: number): Promise<boolean> {
  const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
  if (!o) return false;
  if (o.totalCents !== null) return true;
  const s = await getSettings();
  // Offers first (the customer is on the order now): the rentals total after the one offer (Nov 17, 2026)
  const { refreshOrderTotals } = await import("@/lib/orders");
  await refreshOrderTotals(orderId);
  const [fresh] = await db.select({ subtotalCents: schema.orders.subtotalCents, offerNote: schema.orders.offerNote }).from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
  // One delivery charge per booking (Abraham, Nov 27, 2026, 1:06 AM): a booking of several days (one payment group)
  // has it on its first day, counting every item of the booking; the other days have no delivery charge
  const { bookingItemCount } = await import("@/lib/delivery-rule");
  const group = o.paymentGroupId ? await db.select().from(schema.orders).where(eq(schema.orders.paymentGroupId, o.paymentGroupId)) : [o];
  const live = group.filter((g) => g.status !== "CANCELLED").sort((a, b) => a.eventDate.localeCompare(b.eventDate) || a.id - b.id);
  const first = (live[0] ?? o).id === o.id;
  const groupLines = await db.select({ productId: schema.orderItems.productId, qty: schema.orderItems.qty }).from(schema.orderItems).where(inArray(schema.orderItems.orderId, (live.length ? live : [o]).map((g) => g.id)));
  const t0 = await totalsFor(fresh.subtotalCents, fresh.offerNote, o.deliveryAddress, o.eventDate, s, bookingItemCount(groupLines));
  if (!t0) return false; // outside every zone, or not found: never guessed (pricingProblem says which)
  const { totalsWithFee } = await import("@/lib/pricing");
  const t = first ? t0 : totalsWithFee(fresh.subtotalCents, t0.zone, 0, s);
  // Custom-amount services staff added (Nov 26, 2026) count in the total and the sales tax
  const { serviceSumsFor, withServices } = await import("@/lib/order-services");
  const w = withServices(t, await serviceSumsFor(orderId));
  await db
    .update(schema.orders)
    .set({ deliveryZone: w.zone, deliveryFeeCents: w.deliveryFeeCents, taxPercent: w.taxPercent, taxCents: w.taxCents, totalCents: w.totalCents, servicesCents: w.servicesCents, servicesTaxCents: w.servicesTaxCents, updatedAt: new Date() })
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

/** The booking screen's live total (Nov 24, 2026): exactly what the booking will cost once saved. */
export type BookingQuote = {
  itemsCents: number;
  offerCents: number;
  offerNote: string | null;
  subtotalCents: number;
  deliveryCents: number | null;
  taxCents: number | null;
  taxPercent: number | null;
  totalCents: number | null;
  /** Why there is no delivery price (then no payment link is sent) */
  problem: string | null;
};

/**
 * Prices a booking before it is saved, with the same steps a saved order goes through (createOrderWithItems, then
 * refreshOrderTotals and ensurePriced): item prices, the laser add-on price, the one best offer (customer discount
 * by phone included), then delivery and sales tax. Nothing is written.
 */
export async function quoteBooking(input: { items: { productId: number; qty: number }[]; eventDate: string; thuSun: boolean; phone: string | null; address: string | null }): Promise<BookingQuote> {
  const s = await getSettings();
  const { inArray, sql } = await import("drizzle-orm");
  const items = input.items.filter((i) => i.qty > 0).sort((a, b) => a.productId - b.productId); // the saved order's line order
  const ids = items.map((i) => i.productId);
  const prods = ids.length
    ? await db
        .select({ id: schema.products.id, name: schema.products.name, priceCents: schema.products.priceCents, cat: sql<string>`COALESCE(${schema.categories.name}, '')` })
        .from(schema.products)
        .leftJoin(schema.categories, eq(schema.categories.id, schema.products.categoryId))
        .where(inArray(schema.products.id, ids))
    : [];
  const byId = new Map(prods.map((p) => [p.id, p]));
  const { laserAddonPrices } = await import("@/lib/orders");
  const known = items.filter((i) => byId.has(i.productId));
  // Laser sets are one line each on the saved order (every third set half price), so they are priced one by one here too
  const isLaser = (id: number) => /laser/i.test(byId.get(id)!.cat);
  const units = known.flatMap((i) => (isLaser(i.productId) ? Array.from({ length: i.qty }, () => ({ productId: i.productId, qty: 1 })) : [i]));
  const laser = await laserAddonPrices(db, units.map((i, n) => ({ key: n + 1, name: byId.get(i.productId)!.name, cat: byId.get(i.productId)!.cat, priceCents: byId.get(i.productId)!.priceCents })));
  const lines = units.map((i, n) => ({ id: n + 1, productId: i.productId, qty: i.qty, unitPriceCents: laser.get(n + 1) ?? byId.get(i.productId)!.priceCents, category: byId.get(i.productId)!.cat }));
  const itemsCents = lines.reduce((t, l) => t + l.qty * l.unitPriceCents, 0);
  const { addDays, todayISO } = await import("@/lib/dates");
  const { pickupDateFor } = await import("@/lib/availability");
  const pickupDate = input.thuSun ? addDays(input.eventDate, 4) : pickupDateFor(input.eventDate, s);
  const customerId = input.phone ? ((await db.select({ id: schema.customers.id }).from(schema.customers).where(eq(schema.customers.phone, input.phone)).limit(1))[0]?.id ?? null) : null;
  const { bestOfferFor, offerSwitches } = await import("@/lib/offers");
  const { discountForPhone } = await import("@/lib/customer-discounts");
  const offer = lines.length
    ? await bestOfferFor(db, { id: 0, customerId, eventDate: input.eventDate, pickupDate, spanDays: 0 }, lines, await offerSwitches(db), () => discountForPhone(db as never, input.phone, todayISO()))
    : { discountCents: 0, note: null };
  const subtotalCents = itemsCents - offer.discountCents;
  const { bookingItemCount } = await import("@/lib/delivery-rule");
  const t = lines.length ? await totalsFor(subtotalCents, offer.note, input.address, input.eventDate, s, bookingItemCount(known)) : null;
  return {
    itemsCents,
    offerCents: offer.discountCents,
    offerNote: offer.note,
    subtotalCents,
    deliveryCents: t?.deliveryFeeCents ?? null,
    taxCents: t?.taxCents ?? null,
    taxPercent: t?.taxPercent != null ? Number(t.taxPercent) : null,
    totalCents: t?.totalCents ?? null,
    problem: t || !lines.length ? null : await addressProblem(input.address, s, input.eventDate),
  };
}
