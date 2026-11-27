/**
 * Delivery price rule (Abraham, Nov 27, 2026, 1:06 AM): ONE delivery charge per booking, not per day (extra rental
 * days are free of delivery: the customer keeps the item). The price = the zone price for the first item, plus the
 * "Each additional item" price (Admin Delivery settings, default $5.00) for each more item in the same booking.
 *
 * Counting (until Abraham decides how packs count): each item line's quantity counts as items; the same item on
 * several days of one booking counts once (its largest quantity on any day). A free delivery (promo price $0) stays
 * free: no additional-item charges then (also waiting for his decision).
 */
export type ItemLine = { productId: number; qty: number; day?: string | number };

/**
 * How many items a booking delivers: per item, its largest quantity on any day of the booking. Deep check 06:00 M15:
 * lines of the same item on the same day are added up first (laser sets are saved as one line per set), so 3 sets
 * count 3 on the saved order, the same as on the New booking screen. `day` is the line's day (or order); lines with
 * no day are one day.
 */
export function bookingItemCount(lines: ItemLine[]): number {
  const perDay = new Map<string, number>();
  for (const l of lines) if (l.qty > 0) perDay.set(`${l.day ?? ""}|${l.productId}`, (perDay.get(`${l.day ?? ""}|${l.productId}`) ?? 0) + l.qty);
  const most = new Map<number, number>();
  for (const [k, q] of perDay) {
    const pid = Number(k.split("|")[1]);
    most.set(pid, Math.max(most.get(pid) ?? 0, q));
  }
  return [...most.values()].reduce((n, q) => n + q, 0);
}

/** The Admin "Each additional item" price in cents (default $5.00). */
export function extraItemCents(s: { deliveryExtraItemCents?: string | number | null }): number {
  const n = Number(s.deliveryExtraItemCents ?? 500);
  return Number.isInteger(n) && n >= 0 ? n : 500;
}

/** The booking's whole delivery charge: the first item's zone price, plus the extra price for each more item. */
export function bookingDeliveryCents(firstItemCents: number, itemCount: number, s: { deliveryExtraItemCents?: string | number | null }): number {
  if (firstItemCents <= 0 || itemCount <= 0) return Math.max(0, firstItemCents);
  return firstItemCents + extraItemCents(s) * Math.max(0, itemCount - 1);
}
