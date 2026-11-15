"use server";

import { ensurePriced } from "@/lib/order-pricing";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { ORDER_STATUSES, type OrderStatus } from "@/lib/db/schema";
import { checkBookable } from "@/lib/availability";
import { getOrderWithItems, markPaid, minutesFromNow, orderNumber, PAYMENT_HOLD_MINUTES, setOrderStatus } from "@/lib/orders";
import { payPageLink } from "@/lib/rental-terms";
import { sendOrderText } from "@/lib/notify";
import { parseMoneyToCents } from "@/lib/money";
import { BUSINESS_NAME } from "@/lib/config";
import { dualDate, messageDate } from "@/lib/dual-date";

export type ActionResult = { ok: boolean; message: string };

const OCCUPYING: OrderStatus[] = ["HOLD", "PENDING_PAYMENT", "CONFIRMED", "DELIVERED"];

export async function updateStatusAction(orderId: number, status: OrderStatus, reason = ""): Promise<ActionResult> {
  const staff = await requireAdmin();
  if (!ORDER_STATUSES.includes(status)) return { ok: false, message: "Unknown status" };
  const why = reason.trim().slice(0, 300);
  if (status === "CANCELLED" && !why) return { ok: false, message: "Please write the reason for cancelling." };
  const full = await getOrderWithItems(orderId);
  if (!full) return { ok: false, message: "Order not found" };
  const wasOccupying =
    OCCUPYING.includes(full.order.status) &&
    !(["HOLD", "PENDING_PAYMENT"].includes(full.order.status) && full.order.holdExpiresAt && full.order.holdExpiresAt < new Date());
  if (!wasOccupying && OCCUPYING.includes(status)) {
    // Re-activating an order: make sure the items are still free.
    for (const it of full.items) {
      const [p] = await db.select().from(schema.products).where(eq(schema.products.id, it.productId));
      const free = await checkBookable(it.productId, p.quantity, full.order.eventDate);
      if (free < it.qty) return { ok: false, message: `${it.name} is no longer available for ${dualDate(full.order.eventDate)} (${free} free).` };
    }
  }
  await setOrderStatus(orderId, status, status === "CONFIRMED" || status === "DELIVERED" ? { holdExpiresAt: null } : {}, { reason: why || "Changed by staff in Admin", userId: staff.userId });
  await db.insert(schema.auditLog).values({ userId: staff.userId, action: "order.status", entityType: "order", entityId: String(orderId), before: { status: full.order.status }, after: { status, reason: why || null } });
  revalidatePath("/admin", "layout");
  return { ok: true, message: "Status updated" };
}

export async function recordPaymentAction(orderId: number, amount: string, method: string): Promise<ActionResult> {
  await requireAdmin();
  const cents = parseMoneyToCents(amount);
  if (!cents) return { ok: false, message: "Enter an amount" };
  const r = await markPaid(orderId, cents, method);
  revalidatePath("/admin", "layout");
  return r ? { ok: true, message: "Payment recorded" } : { ok: false, message: "Order not found" };
}

export async function sendPayLinkAction(orderId: number): Promise<ActionResult> {
  const session = await requireAdmin();
  if (!(await ensurePriced(orderId))) return { ok: false, message: "This address has no delivery price on the price map. Enter the quoted delivery fee on this order first, so the link includes delivery and tax." };
  const full = await getOrderWithItems(orderId);
  if (!full) return { ok: false, message: "Order not found" };
  const phone = full.customer?.phone;
  if (!phone) return { ok: false, message: "This customer has no phone number" };
  const due = (full.order.totalCents ?? full.order.subtotalCents) - full.order.paidCents;
  if (due <= 0) return { ok: false, message: "Nothing left to pay" };
  const link = payPageLink(orderId); // review-and-pay page: Terms box, then Sola
  if (full.order.status === "PENDING_PAYMENT") {
    await setOrderStatus(orderId, "PENDING_PAYMENT", { holdExpiresAt: minutesFromNow(PAYMENT_HOLD_MINUTES) });
  }
  const r = await sendOrderText({
    phone,
    email: full.customer?.email,
    subject: `${BUSINESS_NAME} order #${orderNumber(orderId)} payment link`,
    body: `${BUSINESS_NAME} order #${orderNumber(orderId)} for ${messageDate(full.order.eventDate)}: $${(due / 100).toFixed(2)} due. Pay securely here: ${link}`,
    orderId,
    customerId: full.customer?.id,
    userId: session.userId ?? null,
    event: "staff_payment_link",
  });
  revalidatePath("/admin", "layout");
  if (r.texted) return { ok: true, message: "Payment link texted" };
  if (r.emailed) return { ok: true, message: r.message };
  return { ok: false, message: r.message };
}

export async function updateDetailsAction(orderId: number, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  await db
    .update(schema.orders)
    .set({
      deliveryAddress: String(form.get("deliveryAddress") || "") || null,
      notes: String(form.get("notes") || "") || null,
      updatedAt: new Date(),
    })
    .where(eq(schema.orders.id, orderId));
  revalidatePath("/admin", "layout");
  return { ok: true, message: "Saved" };
}

/**
 * Delivery fee quoted by staff (Abraham, Nov 15, 2026): for an address with no price on the price map. Owner and
 * Secretary. Adds tax and the total, then the payment link can go out. Audited.
 */
export async function setQuotedFeeAction(orderId: number, form: FormData): Promise<void> {
  const session = await requireAdmin();
  if (session.role === "delivery") return;
  const cents = parseMoneyToCents(String(form.get("fee") ?? ""));
  if (cents === null || cents < 0) return;
  const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
  if (!o || o.paidCents > 0) return;
  const { getSettings } = await import("@/lib/settings");
  const { totalsWithFee } = await import("@/lib/pricing");
  const t = totalsWithFee(o.subtotalCents, "Quoted by staff", cents, await getSettings());
  await db
    .update(schema.orders)
    .set({ deliveryZone: t.zone, deliveryFeeCents: t.deliveryFeeCents, taxPercent: t.taxPercent, taxCents: t.taxCents, totalCents: t.totalCents, updatedAt: new Date() })
    .where(eq(schema.orders.id, orderId));
  await db.insert(schema.auditLog).values({ userId: session.userId, action: "order.delivery_fee_quoted", entityType: "order", entityId: String(orderId), before: { deliveryFeeCents: o.deliveryFeeCents, totalCents: o.totalCents }, after: { deliveryFeeCents: cents, totalCents: t.totalCents } });
  revalidatePath(`/admin/orders/${orderId}`);
}
