"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getOrderWithItems, setOrderStatus, orderNumber } from "@/lib/orders";
import { sendOrderText } from "@/lib/notify";
import { BUSINESS_NAME } from "@/lib/config";
import { DELIVERY_TEMPLATES, type TemplateKey } from "@/lib/delivery-templates";
import { isCurrentStop } from "@/lib/delivery-stops";
import { hasAnyStop, isMyStop } from "@/lib/drivers";

export type DeliveryResult = { ok: boolean; message: string };

/** Delivery, Owner and Secretary. Template texts only: the body always comes from the approved list, never the browser. */
export async function sendTemplateAction(orderId: number, key: TemplateKey): Promise<DeliveryResult> {
  const staff = await requireStaff(["owner", "secretary", "delivery"]);
  const t = DELIVERY_TEMPLATES[key];
  if (!t) return { ok: false, message: "Choose an approved message." };
  const full = await getOrderWithItems(orderId);
  if (!full?.customer?.phone) return { ok: false, message: "No customer phone on this order." };
  // Delivery staff (Abraham U): only for an order that is one of their current stops (delivery or pickup today,
  // or yesterday's late stop), and only to that order's own phone number (taken from the order, never the browser).
  if (staff.role === "delivery" && (!isCurrentStop(full.order) || !hasAnyStop(full.order, staff.userId))) return { ok: false, message: "You can only text the customer of one of your own stops today." };
  const r = await sendOrderText({
    phone: full.customer.phone,
    email: full.customer.email,
    subject: `${BUSINESS_NAME} order #${orderNumber(orderId)}`,
    body: t.body,
    orderId,
    customerId: full.customer.id,
    userId: staff.userId,
    event: `delivery_${key}`,
  });
  return { ok: r.texted || r.emailed, message: r.texted ? `Sent: ${t.label}` : r.message };
}

/** Delivered (delivery stop) or Picked up (pickup stop). Audited. */
export async function markDoneAction(orderId: number, stop: "delivery" | "pickup"): Promise<DeliveryResult> {
  const staff = await requireStaff(["owner", "secretary", "delivery"]);
  const full = await getOrderWithItems(orderId);
  if (!full) return { ok: false, message: "Order not found." };
  // A Delivery login acts only on its own assigned stops (Abraham, Nov 12, 2026)
  if (staff.role === "delivery" && !isMyStop(full.order, stop, staff.userId)) return { ok: false, message: "This stop isn't assigned to you." };
  const from = full.order.status;
  const ok = stop === "delivery" ? from === "CONFIRMED" : from === "DELIVERED";
  if (!ok) return { ok: false, message: stop === "delivery" ? "Only confirmed (paid) orders can be marked delivered." : "Mark it delivered first." };
  const to = stop === "delivery" ? "DELIVERED" : "PICKED_UP";
  await setOrderStatus(orderId, to);
  await db.insert(schema.auditLog).values({ userId: staff.userId, action: `delivery.${to.toLowerCase()}`, entityType: "order", entityId: String(orderId), before: { status: from }, after: { status: to } });
  revalidatePath("/admin/deliveries");
  return { ok: true, message: to === "DELIVERED" ? "Marked delivered." : "Marked picked up." };
}
