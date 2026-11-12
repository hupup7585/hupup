import { inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";

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
