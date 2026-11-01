"use server";

import { revalidatePath } from "next/cache";
import { asc, eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getUsage, bookableQty } from "@/lib/availability";
import { addDays, isValidISO, longDate, todayISO } from "@/lib/dates";
import { createOrderWithItems, getOrderWithItems, minutesFromNow, orderNumber, PAYMENT_HOLD_MINUTES } from "@/lib/orders";
import { parseMoneyToCents } from "@/lib/money";
import { toE164 } from "@/lib/phone";
import { paymentLink } from "@/lib/sola";
import { sendSms } from "@/lib/notify";
import { BUSINESS_NAME } from "@/lib/config";

export async function availabilityFor(date: string) {
  await requireAdmin();
  if (!isValidISO(date)) return {};
  const prods = await db.select().from(schema.products).where(eq(schema.products.active, true)).orderBy(asc(schema.products.id));
  const usage = await getUsage(date, addDays(date, 1));
  return Object.fromEntries(prods.map((p) => [p.id, bookableQty(p.quantity, usage, p.id, date)]));
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
}): Promise<PosResult> {
  await requireAdmin();
  if (!isValidISO(input.date)) return { ok: false, message: "Pick an event date." };
  if (input.date < todayISO()) return { ok: false, message: "That date is in the past." };
  const items = Object.entries(input.items)
    .map(([id, qty]) => ({ productId: Number(id), qty: Number(qty) }))
    .filter((i) => i.qty > 0);
  if (!items.length) return { ok: false, message: "Add at least one item." };
  if (!input.name.trim()) return { ok: false, message: "Enter the customer's name." };
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

  let message = `Booked order #${orderNumber(r.orderId)}.`;
  if (input.payment === "link" && phone) {
    const full = await getOrderWithItems(r.orderId);
    const link = paymentLink({ orderId: r.orderId, amountCents: full!.order.subtotalCents, name: input.name, email: input.email, phone });
    const sms = await sendSms(
      phone,
      `${BUSINESS_NAME} order #${orderNumber(r.orderId)} for ${longDate(input.date)}: $${(full!.order.subtotalCents / 100).toFixed(2)}. Pay securely within 2 hours to confirm: ${link}`,
    );
    message += sms.sent ? " Payment link texted (held for 2 hours)." : ` Could not text payment link: ${sms.error}`;
  }
  revalidatePath("/admin", "layout");
  return { ok: true, message, orderId: r.orderId };
}
