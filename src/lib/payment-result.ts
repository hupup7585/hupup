import { inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getPaymentGroup, orderNumber } from "@/lib/orders";
import { sendEmail, sendSms } from "@/lib/notify";
import { BUSINESS_NAME, config } from "@/lib/config";
import { businessOrderEmail } from "@/lib/order-email";
import { messageDate } from "@/lib/dual-date";

/**
 * Paid or Declined on the order (Admin and the orders sheet), with the date and time and the card's last 4 only
 * (Abraham, Nov 12, 2026). A repeated notice for the same Sola reference changes nothing new. Audited.
 */
export async function recordPaymentResult(orderIds: number[], result: "approved" | "declined", last4: string | null, ref: string | null, at = new Date()) {
  if (!orderIds.length) return;
  const safeLast4 = last4 && /^\d{4}$/.test(last4) ? last4 : null;
  await db.update(schema.orders).set({ paymentResult: result, paymentResultAt: at, cardLast4: safeLast4, updatedAt: at }).where(inArray(schema.orders.id, orderIds));
  await db.insert(schema.auditLog).values({
    action: result === "approved" ? "payment.approved" : "payment.declined",
    entityType: "order",
    entityId: String(orderIds[0]),
    after: { orders: orderIds, result, cardLast4: safeLast4, solaRef: ref, at: at.toISOString() },
  });
}

/** "Paid Nov 12, 2026, 3:05 PM, card ending 1111" / "Declined ..." for Admin and the orders sheet. */
export function paymentResultLabel(o: { paymentResult: string | null; paymentResultAt: Date | string | null; cardLast4: string | null }): string {
  if (!o.paymentResult || !o.paymentResultAt) return "";
  const at = new Date(o.paymentResultAt).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  return `${o.paymentResult === "approved" ? "Paid" : "Declined"} ${at}${o.cardLast4 ? `, card ending ${o.cardLast4}` : ""}`;
}

/** After a payment (Sola on the website, Stripe on the phone): the customer's confirmation, the owner's alerts. */
export async function paymentReceivedNotices(orderId: number, cents: number) {
  const group = await getPaymentGroup(orderId);
  if (!group) return;
  const before = group.primary;
  const days = group.orders;
  const num = orderNumber(orderId);
  const msg =
    days.length > 1
      ? `${BUSINESS_NAME}: payment received for order #${num}. You're all set for ${days.map((d) => messageDate(d.order.eventDate)).join(" and ")}! We'll deliver and pick up on the days you chose.`
      : `${BUSINESS_NAME}: payment received for order #${num}. You're all set for ${messageDate(before.order.eventDate)}! We'll deliver that day and pick up ${messageDate(before.order.pickupDate)}.`;
  // Order/service text only with order-text consent (checked in sendMessage); the email copy goes out as before.
  if (before.customer?.phone) await sendSms(before.customer.phone, msg, { kind: "transactional", event: "payment_confirmation", orderId, customerId: before.customer.id });
  if (before.customer?.email) await sendEmail(before.customer.email, `Order #${num} confirmed`, msg);
  if (process.env.ADMIN_PHONE) {
    await sendSms(process.env.ADMIN_PHONE, `New paid order #${num}: $${(cents / 100).toFixed(2)} for ${messageDate(before.order.eventDate)}${days.length > 1 ? ` and ${days.length - 1} more day${days.length > 2 ? "s" : ""}` : ""}.`, { kind: "system", event: "owner_alert" });
  }
  // The business gets the full order details by email
  if (config.adminEmail()) {
    for (const d of days) {
      const mail = businessOrderEmail(d, days.length > 1 ? (d.order.totalCents ?? d.order.subtotalCents) : cents);
      await sendEmail(config.adminEmail(), mail.subject, mail.text);
    }
  }
}
