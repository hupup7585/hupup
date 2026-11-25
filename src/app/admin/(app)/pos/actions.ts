"use server";

import { alertSharedPhoneOrder } from "@/lib/shared-phones";

import { ensurePriced, pricingProblem } from "@/lib/order-pricing";

import { headers } from "next/headers";
import { recordBookingConsents } from "@/lib/booking-consent";
import { revalidatePath } from "next/cache";
import { asc, eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { applyLaserPools, getUsage, bookableQty, laserPoolInfo, pickupDateFor } from "@/lib/availability";
import { getSettings } from "@/lib/settings";
import { checkEventDate, dayInfo } from "@/lib/jewish-calendar";
import { holidayWeek } from "@/lib/holiday-rentals";
import { addDays, isValidISO, todayISO } from "@/lib/dates";
import { createOrderWithItems, getOrderWithItems, minutesFromNow, orderNumber, PAYMENT_HOLD_MINUTES, POS_LINK_HOLD_MINUTES } from "@/lib/orders";
import { parseMoneyToCents } from "@/lib/money";
import { toE164 } from "@/lib/phone";
import { CURRENT_TERMS_VERSION, payPageLink, recordTermsAcceptance, termsActive } from "@/lib/rental-terms";
import { TERMS_TEXT } from "@/lib/terms-content";

const TERMS_VIA = ["phone", "text", "email", "in_person"] as const;
import { sendOrderText } from "@/lib/notify";
import { BUSINESS_NAME } from "@/lib/config";
import { dualDate, messageDate } from "@/lib/dual-date";

export async function availabilityFor(date: string) {
  await requireAdmin();
  if (!isValidISO(date)) return {};
  const prods = await db.select().from(schema.products).where(eq(schema.products.active, true)).orderBy(asc(schema.products.id));
  const pickup = pickupDateFor(date, await getSettings());
  const usage = await getUsage(date, pickup);
  applyLaserPools(usage, await laserPoolInfo()); // shared laser gun packs (Nov 24, 2026)
  return Object.fromEntries(prods.map((p) => [p.id, bookableQty(p.quantity, usage, p.id, date, pickup)]));
}

export type CalendarDay = { date: string; hebrew: string; hebrewHe: string; names: string[]; closed: boolean; reason: string | null; closesAtLabel: string | null; /** Chanukah or Chol Hamoed week (Nov 24, 2026: light blue on the calendar) */ holidayWeek?: "chanukah" | "cholHamoed" | null };
export type DateCheck = { ok: boolean; message: string | null; pickupWarning: string | null; pickup: string; day: CalendarDay };

// Staff screen: Hebrew-letter holiday names (Abraham); days without one keep the calendar name
const plainDay = (d: ReturnType<typeof dayInfo>): CalendarDay => ({ date: d.date, hebrew: d.hebrew, hebrewHe: d.hebrewHe, names: d.namesYi, closed: d.closed, reason: d.reasonYi ?? d.reason, closesAtLabel: d.closesAtLabel, holidayWeek: holidayWeek(d.date) });

/** Jewish-calendar info for the POS: the coming days, and the selected event date. */
export async function calendarFor(start: string, days = 14): Promise<CalendarDay[]> {
  await requireAdmin();
  if (!isValidISO(start)) return [];
  const cal = await getSettings();
  return Array.from({ length: Math.min(days, 60) }, (_, i) => plainDay(dayInfo(addDays(start, i), cal)));
}

export async function checkDateFor(date: string): Promise<DateCheck | null> {
  await requireAdmin();
  if (!isValidISO(date)) return null;
  const cal = await getSettings();
  const c = checkEventDate(date, cal);
  return { ok: c.ok, message: c.message, pickupWarning: c.pickupWarning, pickup: pickupDateFor(date, cal), day: plainDay(c.day) };
}

export type PosResult = { ok: boolean; message: string; orderId?: number; /** Credit card by staff: Sola's secure card page for this order */ cardUrl?: string; cardCents?: number };

/** The live total on the booking screen (Nov 24, 2026): the same math the saved booking gets. */
export async function quoteAction(input: { date: string; items: Record<string, number>; phone: string; address: string; thuSun: boolean }): Promise<import("@/lib/order-pricing").BookingQuote | null> {
  await requireAdmin();
  if (!isValidISO(input.date)) return null;
  const s = await getSettings();
  const thuSun = Boolean(input.thuSun) && Boolean(s.offerThuSunOn) && new Date(`${input.date}T12:00:00Z`).getUTCDay() === 4;
  const { quoteBooking } = await import("@/lib/order-pricing");
  return quoteBooking({
    items: Object.entries(input.items).map(([id, qty]) => ({ productId: Number(id), qty: Number(qty) })),
    eventDate: input.date,
    thuSun,
    phone: input.phone ? toE164(input.phone) : null,
    address: input.address.trim() || null,
  });
}

export async function createBookingAction(input: {
  date: string;
  items: Record<string, number>;
  name: string;
  phone: string;
  email: string;
  address: string;
  deliveryTime: string;
  notes: string;
  payment: "link" | "card" | "cash" | "check" | "later";
  amountPaid: string;
  /** How the customer accepted the Terms and Conditions (required). */
  termsVia: string;
  /** The two optional text-consent boxes (both unchecked by default; never required) */
  smsTransactional?: boolean;
  smsMarketing?: boolean;
  /** Thursday to Sunday (Abraham, Nov 17, 2026): delivered Thursday, picked up Monday, 1.5 times the rental */
  thuSun?: boolean;
}): Promise<PosResult> {
  {
    // Abraham, Nov 14, 2026: no booking on Shabbes or Yom Tov (candle lighting until Rabbeinu Tam)
    const { bookingLock } = await import("@/lib/jewish-calendar");
    const { getSettings } = await import("@/lib/settings");
    const lock = bookingLock((await import("@/lib/clock")).calendarNow(), await getSettings());
    if (lock.locked) return { ok: false, message: `Booking is closed on ${lock.reason}. It opens again after ${lock.reason}.` } as PosResult;
  }
  const session = await requireAdmin();
  if (!isValidISO(input.date)) return { ok: false, message: "Pick an event date." };
  if (input.date < todayISO()) return { ok: false, message: "That date is in the past." };
  const dateCheck = checkEventDate(input.date, await getSettings());
  if (!dateCheck.ok) return { ok: false, message: dateCheck.message ?? "We're closed on that day." };
  const items = Object.entries(input.items)
    .map(([id, qty]) => ({ productId: Number(id), qty: Number(qty) }))
    .filter((i) => i.qty > 0);
  if (!items.length) return { ok: false, message: "Add at least one item." };
  if (!input.name.trim()) return { ok: false, message: "Enter the customer's name." };
  if (termsActive() && !TERMS_VIA.includes(input.termsVia as (typeof TERMS_VIA)[number])) return { ok: false, message: "Choose how the customer accepted the Terms and Conditions." };
  const phone = input.phone ? toE164(input.phone) : null;
  if (input.phone && !phone) return { ok: false, message: "Phone number doesn't look right." };
  if (input.payment === "link" && !phone) return { ok: false, message: "A phone number is needed to text a payment link." };

  // Deliveries bug 1 (Nov 24, 2026, order 1068): delivery always applies, so no booking with an address that can't be
  // priced (no town or zip, outside every zone), whatever the payment
  {
    const { addressProblem } = await import("@/lib/order-pricing");
    const problem = await addressProblem(input.address.trim() || null, await getSettings(), input.date);
    if (problem) return { ok: false, message: `Not booked. ${problem}` };
  }
  const paidCents = input.payment === "cash" || input.payment === "check" ? parseMoneyToCents(input.amountPaid) ?? 0 : 0;
  // Credit card by staff (Nov 24, 2026): typed on Sola's secure page, never on ours; Sola's webhook marks it paid
  if (input.payment === "card") {
    const { onlinePaymentReady, PAYMENT_UNAVAILABLE } = await import("@/lib/sola");
    if (!onlinePaymentReady()) return { ok: false, message: `${PAYMENT_UNAVAILABLE.replace("Please call us.", "")}Card payments need SOLA_PAYMENTSITE_NAME in Vercel.`.trim() };
  }
  const status = input.payment === "link" || input.payment === "card" ? "PENDING_PAYMENT" : "CONFIRMED";

  // Thursday to Sunday: only while the offer is on, and only for a Thursday (pickup Monday)
  const s = await getSettings();
  const thuSun = Boolean(input.thuSun) && Boolean(s.offerThuSunOn) && new Date(`${input.date}T12:00:00Z`).getUTCDay() === 4;
  const r = await createOrderWithItems({
    ...(thuSun ? { pickupDate: addDays(input.date, 4) } : {}),
    items,
    eventDate: input.date,
    channel: "POS",
    status,
    holdExpiresAt: input.payment === "link" || input.payment === "card" ? minutesFromNow(POS_LINK_HOLD_MINUTES) /* New booking link (Abraham, Nov 13, 2026: 25 minutes) */ : null,
    customer: { name: input.name.trim(), phone, email: input.email.trim() || null, address: input.address.trim() || null },
    deliveryTime: input.deliveryTime || null,
    notes: input.notes || null,
    paymentMethod: paidCents ? input.payment : null,
    paidCents,
  });
  if (!r.ok) {
    if (r.reason === "unavailable") return { ok: false, message: `Not enough units available for ${dualDate(input.date)} (only ${r.free} left of one item). Refresh availability.` };
    if (r.reason === "needs_maze") return { ok: false, message: "Not booked. The additional laser gun packs go only with an inflatable maze on the same booking." };
    return { ok: false, message: "Could not create the booking." };
  }
  // Offers need the customer on the order (4th Sunday free counts their Sundays): the rentals total again
  {
    const { refreshOrderTotals } = await import("@/lib/orders");
    await refreshOrderTotals(r.orderId);
  }

  // Log the customer's acceptance of the Terms, as chosen by staff (only while the Terms flow is on).
  const reqHeaders = await headers();
  if (termsActive()) await recordTermsAcceptance({
    orderId: r.orderId,
    phone,
    // The staff member's device (who entered it is userId); the customer's own channel is in the method
    ip: (reqHeaders.get("x-forwarded-for") || "").split(",")[0].trim() || null,
    userAgent: reqHeaders.get("user-agent")?.slice(0, 500) ?? null,
    termsVersion: CURRENT_TERMS_VERSION,
    termsText: TERMS_TEXT,
    method: `staff_${input.termsVia}` as "staff_phone",
    acceptanceStatement: `Staff recorded that the customer accepted the Terms and Conditions by ${input.termsVia.replace("_", " ")} for reservation #${orderNumber(r.orderId)}`,
    userId: session.userId ?? null,
  });
  // Text consent the staff member checked after reading the approved wording to the customer
  const consents = await recordBookingConsents({
    phone,
    transactional: input.smsTransactional === true,
    marketing: input.smsMarketing === true,
    source: "pos",
    orderId: r.orderId,
    userId: session.userId ?? null,
    ip: (reqHeaders.get("x-forwarded-for") || "").split(",")[0].trim() || null,
    userAgent: reqHeaders.get("user-agent")?.slice(0, 500) ?? null,
  });
  let message = `Booked order number ${orderNumber(r.orderId)}.`;
  if (consents.stopped) message += " Text consent wasn't saved: this number replied STOP (the customer can text START to get texts again).";
  // Price the booking (items + delivery + tax) so the link and every total include delivery and tax
  const priced = await ensurePriced(r.orderId);
  let cardUrl: string | undefined;
  let cardCents: number | undefined;
  if (input.payment === "card") {
    if (!priced) message += ` Card not charged: ${(await pricingProblem(r.orderId)) ?? "the order has no price yet."}`;
    else {
      const { paymentLink } = await import("@/lib/sola");
      const full = await getOrderWithItems(r.orderId);
      const link = paymentLink({ orderId: r.orderId, amountCents: full!.order.totalCents ?? full!.order.subtotalCents, name: full?.customer?.name, email: full?.customer?.email, phone: full?.customer?.phone });
      if (link) {
        cardUrl = link;
        cardCents = full!.order.totalCents ?? full!.order.subtotalCents;
        message += ` Open the secure card page and enter the card. The order shows Paid as soon as Sola approves it (held for ${POS_LINK_HOLD_MINUTES} minutes).`;
      } else message += " Card page not available: SOLA_PAYMENTSITE_NAME is missing in Vercel.";
    }
  } else if (input.payment === "link" && phone && !priced) {
    message += ` Payment link not sent. ${(await pricingProblem(r.orderId)) ?? ""}`;
  } else if (input.payment === "link" && phone) {
    const full = await getOrderWithItems(r.orderId);
    const link = payPageLink(r.orderId); // review-and-pay page: Terms box, then Sola
    const sent = await sendOrderText({
      phone,
      email: input.email || null,
      subject: `${BUSINESS_NAME} order #${orderNumber(r.orderId)} payment link`,
      body: `${BUSINESS_NAME} order #${orderNumber(r.orderId)} for ${messageDate(input.date)}: $${((full!.order.totalCents ?? full!.order.subtotalCents) / 100).toFixed(2)}. Pay securely within ${POS_LINK_HOLD_MINUTES} minutes to confirm: ${link}`,
      orderId: r.orderId,
      customerId: full?.customer?.id ?? null,
      userId: session.userId ?? null,
      event: "staff_payment_link",
    });
    message += sent.texted ? ` Payment link texted (held for ${POS_LINK_HOLD_MINUTES} minutes).` : sent.emailed ? ` No text consent: payment link emailed (held for ${POS_LINK_HOLD_MINUTES} minutes).` : ` Payment link not texted: ${sent.message}`;
  }
  // A number two directory entries share (Abraham, Nov 22, 2026): alert him right away
  await alertSharedPhoneOrder({ phone: phone ?? null, name: input.name, address: input.address, orderIds: [r.orderId], source: "staff" }).catch((e) => console.error("shared number alert", e));
  revalidatePath("/admin", "layout");
  return { ok: true, message, orderId: r.orderId, ...(cardUrl ? { cardUrl, cardCents } : {}) };
}

export type DirectoryHit = { id: number; lastName: string; firstName: string; house: string; street: string; unit: string | null; town: string; zip: string; phone: string | null; address: string; shared: boolean };

/**
 * New booking: Directory entries matching a phone number, a name or a street (Abraham, Nov 24, 2026). The Directory
 * list is Owner only (Nov 22-23, 2026), so the Secretary gets no suggestions here.
 */
export async function directorySuggestAction(q: string): Promise<DirectoryHit[]> {
  const me = await requireAdmin();
  if (me.role !== "owner") return [];
  const text = q.trim();
  if (text.length < 2) return [];
  const { sql, and, or, ilike } = await import("drizzle-orm");
  const d = schema.directoryEntries;
  const { phoneQueryDigits } = await import("@/lib/phone-search");
  const pd = phoneQueryDigits(text); // however it is typed (Nov 24, 2026); start, local start or last 4 (Nov 25, 2026)
  const digits = pd ?? "";
  const { phoneMatchSql } = await import("@/lib/phone-search-sql");
  const words = text.replace(/[^\p{L}\p{N}\s'-]/gu, " ").split(/\s+/).filter((w) => /\p{L}/u.test(w)); // a phone number typed with dashes is not a name
  const conds = [];
  if (digits.length >= 3) conds.push(or(phoneMatchSql(d.phone, digits), ilike(d.house, `${digits}%`))!);
  for (const w of words) conds.push(or(ilike(d.lastName, `${w}%`), ilike(d.firstName, `${w}%`), ilike(d.street, `%${w}%`), ilike(d.yiddishLastName, `${w}%`), ilike(d.yiddishFirstName, `${w}%`))!);
  if (!conds.length) return [];
  const rows = await db.select().from(d).where(and(...conds)).orderBy(d.lastName, d.firstName, d.id).limit(12);
  const phones = [...new Set(rows.map((r) => r.phone).filter(Boolean))] as string[];
  const counts = new Map<string, number>();
  if (phones.length) {
    const c = await db.execute(sql`SELECT phone, COUNT(*)::int AS n FROM directory_entries WHERE phone IN (${sql.join(phones.map((p) => sql`${p}`), sql`, `)}) GROUP BY phone`);
    for (const x of c.rows as { phone: string; n: number }[]) counts.set(x.phone, Number(x.n));
  }
  const { findStreet } = await import("@/lib/streets");
  return rows.map((r) => {
    const street = findStreet(r.street)?.spoken ?? r.street;
    return {
      id: r.id,
      lastName: r.lastName,
      firstName: r.firstName,
      house: r.house,
      street: r.street,
      unit: r.unit,
      town: r.town,
      zip: r.zip,
      phone: r.phone,
      address: `${r.house} ${street}${r.unit ? `, unit ${r.unit}` : ""}, ${r.town}, NY ${r.zip}`,
      shared: (r.phone ? counts.get(r.phone) ?? 1 : 1) > 1,
    };
  });
}
