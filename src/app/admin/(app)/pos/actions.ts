"use server";

import { ensurePriced } from "@/lib/order-pricing";

import { headers } from "next/headers";
import { recordBookingConsents } from "@/lib/booking-consent";
import { revalidatePath } from "next/cache";
import { asc, eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getUsage, bookableQty, pickupDateFor } from "@/lib/availability";
import { getSettings } from "@/lib/settings";
import { checkEventDate, dayInfo } from "@/lib/jewish-calendar";
import { addDays, isValidISO, todayISO } from "@/lib/dates";
import { createOrderWithItems, getOrderWithItems, minutesFromNow, orderNumber, PAYMENT_HOLD_MINUTES } from "@/lib/orders";
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
  return Object.fromEntries(prods.map((p) => [p.id, bookableQty(p.quantity, usage, p.id, date, pickup)]));
}

export type CalendarDay = { date: string; hebrew: string; hebrewHe: string; names: string[]; closed: boolean; reason: string | null; closesAtLabel: string | null };
export type DateCheck = { ok: boolean; message: string | null; pickupWarning: string | null; pickup: string; day: CalendarDay };

// Staff screen: Hebrew-letter holiday names (Abraham); days without one keep the calendar name
const plainDay = (d: ReturnType<typeof dayInfo>): CalendarDay => ({ date: d.date, hebrew: d.hebrew, hebrewHe: d.hebrewHe, names: d.namesYi, closed: d.closed, reason: d.reasonYi ?? d.reason, closesAtLabel: d.closesAtLabel });

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

export type PosResult = { ok: boolean; message: string; orderId?: number };

export async function createBookingAction(input: {
  date: string;
  items: Record<string, number>;
  name: string;
  phone: string;
  email: string;
  address: string;
  deliveryTime: string;
  notes: string;
  payment: "link" | "cash" | "check" | "later";
  amountPaid: string;
  /** How the customer accepted the Terms and Conditions (required). */
  termsVia: string;
  /** The two optional text-consent boxes (both unchecked by default; never required) */
  smsTransactional?: boolean;
  smsMarketing?: boolean;
}): Promise<PosResult> {
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

  const paidCents = input.payment === "cash" || input.payment === "check" ? parseMoneyToCents(input.amountPaid) ?? 0 : 0;
  const status = input.payment === "link" ? "PENDING_PAYMENT" : "CONFIRMED";

  const r = await createOrderWithItems({
    items,
    eventDate: input.date,
    channel: "POS",
    status,
    holdExpiresAt: input.payment === "link" ? minutesFromNow(PAYMENT_HOLD_MINUTES * 4) : null,
    customer: { name: input.name.trim(), phone, email: input.email.trim() || null, address: input.address.trim() || null },
    deliveryTime: input.deliveryTime || null,
    notes: input.notes || null,
    paymentMethod: paidCents ? input.payment : null,
    paidCents,
  });
  if (!r.ok) {
    if (r.reason === "unavailable") return { ok: false, message: `Not enough units available for ${dualDate(input.date)} (only ${r.free} left of one item). Refresh availability.` };
    return { ok: false, message: "Could not create the booking." };
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
  if (input.payment === "link" && phone && !priced) {
    message += " Payment link not sent: the delivery address isn't inside the delivery area, so delivery and tax can't be added. Fix the address on the order, then send the link from the order page.";
  } else if (input.payment === "link" && phone) {
    const full = await getOrderWithItems(r.orderId);
    const link = payPageLink(r.orderId); // review-and-pay page: Terms box, then Sola
    const sent = await sendOrderText({
      phone,
      email: input.email || null,
      subject: `${BUSINESS_NAME} order #${orderNumber(r.orderId)} payment link`,
      body: `${BUSINESS_NAME} order #${orderNumber(r.orderId)} for ${messageDate(input.date)}: $${((full!.order.totalCents ?? full!.order.subtotalCents) / 100).toFixed(2)}. Pay securely within 2 hours to confirm: ${link}`,
      orderId: r.orderId,
      customerId: full?.customer?.id ?? null,
      userId: session.userId ?? null,
      event: "staff_payment_link",
    });
    message += sent.texted ? " Payment link texted (held for 2 hours)." : sent.emailed ? " No text consent: payment link emailed (held for 2 hours)." : ` Payment link not texted: ${sent.message}`;
  }
  revalidatePath("/admin", "layout");
  return { ok: true, message, orderId: r.orderId };
}
