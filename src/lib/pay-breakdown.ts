import { dayInfo, type CalendarSettings } from "@/lib/jewish-calendar";
import { messageDate } from "@/lib/dual-date";
import { pickupAfterShabbesMin, type HolidaySettings } from "@/lib/holiday-rentals";

/**
 * Pay page labels (Abraham, Nov 27, 2026, item 4). The lines on the pay page, the payment link email and the receipt
 * add up to "Total due":
 *   charges of each rental day still to pay (items, services, delivery, sales tax)
 *   - "Discount": each offer line ("Offer: 4th Sunday free, minus $<amount>")
 *   - "Partial payment": "Paid so far: $<amount>"
 *   = "Total due"
 * "Already paid": each day already paid, with "Already paid" beside it, NOT counted in Total due.
 * A heading shows only when it has lines.
 *
 * Pickup sentence: a rental picked up Saturday night (Friday rentals on Chanukah and Chol Hamoed) gets exactly
 * "Please have the rental outside your door on Mutze Shabbes <time>." (Shabbes ends + the Admin Mutze Shabbes pickup
 * minutes, Offers page); every other rental keeps the 9:00 AM sentence.
 */

type Item = { qty: number; name: string; unitPriceCents: number };
type Service = { name: string; amountCents: number; note?: string | null; showNoteOnReceipt?: boolean | null };
export type BreakdownDay = {
  order: {
    id: number;
    status: string;
    eventDate: string;
    pickupDate: string;
    subtotalCents: number;
    totalCents: number | null;
    paidCents: number;
    deliveryFeeCents: number;
    taxCents: number;
    taxPercent: string | null;
    offerDiscountCents: number;
    offerNote: string | null;
  };
  items: Item[];
  services?: Service[] | null;
};

export type Line = { label: string; cents: number; note?: string };
export type PayBreakdown = {
  /** Each rental day still to pay: its charge lines (positive amounts) */
  days: { orderId: number; eventDate: string; pickupDate: string; lines: Line[] }[];
  /** "Discount" heading: each offer line, subtracted */
  discounts: Line[];
  /** "Already paid" heading: each day already paid, shown with "Already paid" beside it; never counted */
  alreadyPaid: Line[];
  /** "Partial payment" heading: "Paid so far", subtracted before Total due (0 = no heading) */
  paidSoFarCents: number;
  totalDueCents: number;
};

export const BREAKDOWN_LABELS = { discount: "Discount", alreadyPaid: "Already paid", partial: "Partial payment", paidSoFar: "Paid so far", totalDue: "Total due" } as const;
export const PICKUP_9AM_SENTENCE = "On your pickup day, please have the rental outside your door by 9:00 AM.";
export const DELIVERY_SENTENCE = "We deliver between 9:00 AM and 12:00 PM on your delivery day.";

const money = (c: number) => `$${(Math.abs(c) / 100).toFixed(2)}`;
const CUSTOMER_DISCOUNT = /^Customer discount: /;

/** "Offer: 4th Sunday free, minus $25.00" (a customer discount keeps its own name: "Customer discount: 10%, minus $5.00"). */
export function discountLabel(note: string | null, cents: number): string {
  const n = (note ?? "").trim();
  const name = CUSTOMER_DISCOUNT.test(n) ? n : `Offer: ${n || "discount"}`;
  return `${name}, minus ${money(cents)}`;
}

function chargeLines(d: BreakdownDay): Line[] {
  const o = d.order;
  const lines: Line[] = [
    ...d.items.map((i) => ({ label: `${i.qty} × ${i.name}`, cents: i.qty * i.unitPriceCents })),
    ...(d.services ?? []).map((s) => ({ label: s.name, cents: s.amountCents, ...(s.showNoteOnReceipt && s.note ? { note: s.note } : {}) })),
  ];
  if (o.totalCents !== null) {
    lines.push({ label: "Delivery", cents: o.deliveryFeeCents });
    lines.push({ label: `Sales tax (${o.taxPercent ?? "0"}%)`, cents: o.taxCents });
  }
  // Every day adds up (an Owner custom charge with no item lines, or a total set by hand): the rest as one line
  const shown = lines.reduce((n, l) => n + l.cents, 0) - o.offerDiscountCents;
  const total = o.totalCents ?? o.subtotalCents;
  if (shown !== total) lines.push({ label: "Rentals", cents: total - shown });
  return lines;
}

const dayItems = (d: BreakdownDay) => [...d.items.map((i) => `${i.qty} × ${i.name}`), ...(d.services ?? []).map((s) => s.name)].join(", ");

/**
 * The grouped lines for a payment group. `paidNowCents` (receipt only): the amount just paid; the rest of what was paid
 * before shows as "Paid so far", and Total due equals the amount just paid.
 */
export function payBreakdown(orders: BreakdownDay[], o: { paidNowCents?: number } = {}): PayBreakdown {
  const live = orders.filter((d) => d.order.status !== "CANCELLED");
  const receipt = o.paidNowCents !== undefined;
  const open = receipt ? live : live.filter((d) => d.order.status === "PENDING_PAYMENT");
  const done = receipt ? [] : live.filter((d) => d.order.status !== "PENDING_PAYMENT" && d.order.paidCents > 0);
  const days = open.map((d) => ({ orderId: d.order.id, eventDate: d.order.eventDate, pickupDate: d.order.pickupDate, lines: chargeLines(d) }));
  const discounts = open.filter((d) => d.order.offerDiscountCents > 0).map((d) => ({ label: discountLabel(d.order.offerNote, d.order.offerDiscountCents), cents: -d.order.offerDiscountCents }));
  const alreadyPaid = done.map((d) => ({ label: `${messageDate(d.order.eventDate)}: ${dayItems(d)}`, cents: d.order.paidCents }));
  const charged = days.reduce((n, d) => n + d.lines.reduce((m, l) => m + l.cents, 0), 0) + discounts.reduce((n, l) => n + l.cents, 0);
  const paid = open.reduce((n, d) => n + d.order.paidCents, 0);
  const paidSoFarCents = receipt ? Math.max(0, paid - (o.paidNowCents ?? 0)) : Math.min(paid, charged);
  return { days, discounts, alreadyPaid, paidSoFarCents, totalDueCents: Math.max(0, charged - paidSoFarCents) };
}

/** The Mutze Shabbes pickup time ("8:45 PM"): Shabbes ends (the calendar's reopen time) + the Admin pickup minutes. */
export function mutzePickupTime(saturday: string, s: CalendarSettings & HolidaySettings): string | null {
  const ends = dayInfo(saturday, s).reopensAt;
  if (!ends) return null;
  const at = new Date(ends.getTime() + pickupAfterShabbesMin(s) * 60_000);
  return at.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
}

const isSaturday = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay() === 6;

/**
 * The pickup sentence: exactly "Please have the rental outside your door on Mutze Shabbes <time>." when a rental is
 * picked up Saturday night (Friday rentals on Chanukah and Chol Hamoed), else the 9:00 AM sentence.
 */
export function pickupSentence(days: { pickupDate: string }[], s: CalendarSettings & HolidaySettings): string {
  const sat = days.find((d) => isSaturday(d.pickupDate));
  const time = sat ? mutzePickupTime(sat.pickupDate, s) : null;
  return time ? `Please have the rental outside your door on Mutze Shabbes ${time}.` : PICKUP_9AM_SENTENCE;
}

/** The same grouping as plain text, for the payment link email and the receipt. */
export function payBreakdownText(b: PayBreakdown, pickup?: string): string {
  const row = (l: Line) => `${l.label}: ${l.cents < 0 ? `-${money(l.cents)}` : money(l.cents)}`;
  const out: string[] = [];
  for (const d of b.days) {
    out.push(`${messageDate(d.eventDate)} (pickup ${messageDate(d.pickupDate)})`);
    for (const l of d.lines) out.push(`  ${row(l)}${l.note ? ` (${l.note})` : ""}`);
  }
  if (b.discounts.length) out.push("", BREAKDOWN_LABELS.discount, ...b.discounts.map((l) => `  ${l.label}`));
  if (b.alreadyPaid.length) out.push("", BREAKDOWN_LABELS.alreadyPaid, ...b.alreadyPaid.map((l) => `  ${l.label}: ${money(l.cents)}, ${BREAKDOWN_LABELS.alreadyPaid}`));
  if (b.paidSoFarCents > 0) out.push("", BREAKDOWN_LABELS.partial, `  ${BREAKDOWN_LABELS.paidSoFar}: ${money(b.paidSoFarCents)}`);
  out.push("", `${BREAKDOWN_LABELS.totalDue}: ${money(b.totalDueCents)}`);
  if (pickup) out.push("", `${DELIVERY_SENTENCE} ${pickup}`);
  return out.join("\n");
}
