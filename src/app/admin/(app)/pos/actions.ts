"use server";

import { revalidatePath } from "next/cache";
import { asc, eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getUsage, bookableQty, pickupDateFor } from "@/lib/availability";
import { getSettings } from "@/lib/settings";
import { checkEventDate, dayInfo } from "@/lib/jewish-calendar";
import { addDays, isValidISO, longDate, todayISO } from "@/lib/dates";
import { createOrderWithItems, getOrderWithItems, minutesFromNow, orderNumber, PAYMENT_HOLD_MINUTES } from "@/lib/orders";
import { parseMoneyToCents } from "@/lib/money";
import { toE164 } from "@/lib/phone";
import { CURRENT_TERMS_VERSION, payPageLink, recordTermsAcceptance } from "@/lib/rental-terms";
import { TERMS_TEXT } from "@/lib/terms-content";

const TERMS_VIA = ["phone", "text", "email", "in_person"] as const;
import { sendOrderText } from "@/lib/notify";
import { BUSINESS_NAME } from "@/lib/config";

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

const plainDay = (d: ReturnType<typeof dayInfo>): CalendarDay => ({ date: d.date, hebrew: d.hebrew, hebrewHe: d.hebrewHe, names: d.names, closed: d.closed, reason: d.reason, closesAtLabel: d.closesAtLabel });

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
  if (!TERMS_VIA.includes(input.termsVia as (typeof TERMS_VIA)[number])) return { ok: false, message: "Choose how the customer accepted the Terms and Conditions." };
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
    if (r.reason === "unavailable") return { ok: false, message: `Not enough units available for ${longDate(input.date)} (only ${r.free} left of one item). Refresh availability.` };
    return { ok: false, message: "Could not create the booking." };
  }

  // Log the customer's acceptance of the Terms, as chosen by staff.
  await recordTermsAcceptance({
    orderId: r.orderId,
    phone,
    termsVersion: CURRENT_TERMS_VERSION,
    termsText: TERMS_TEXT,
    method: `staff_${input.termsVia}` as "staff_phone",
    acceptanceStatement: `Staff recorded that the customer accepted the Terms and Conditions by ${input.termsVia.replace("_", " ")} for reservation #${orderNumber(r.orderId)}`,
    userId: session.userId ?? null,
  });
  let message = `Booked order #${orderNumber(r.orderId)}.`;
  if (input.payment === "link" && phone) {
    const full = await getOrderWithItems(r.orderId);
    const link = payPageLink(r.orderId); // review-and-pay page: Terms box, then Sola
    const sent = await sendOrderText({
      phone,
      email: input.email || null,
      subject: `${BUSINESS_NAME} order #${orderNumber(r.orderId)} payment link`,
      body: `${BUSINESS_NAME} order #${orderNumber(r.orderId)} for ${longDate(input.date)}: $${(full!.order.subtotalCents / 100).toFixed(2)}. Pay securely within 2 hours to confirm: ${link}`,
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
