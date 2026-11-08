"use server";

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

export async function updateStatusAction(orderId: number, status: OrderStatus): Promise<ActionResult> {
  await requireAdmin();
  if (!ORDER_STATUSES.includes(status)) return { ok: false, message: "Unknown status" };
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
  await setOrderStatus(orderId, status, status === "CONFIRMED" || status === "DELIVERED" ? { holdExpiresAt: null } : {});
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
