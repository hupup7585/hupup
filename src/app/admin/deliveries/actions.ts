"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getOrderWithItems, setOrderStatus, orderNumber } from "@/lib/orders";
import { sendOrderText } from "@/lib/notify";
import { BUSINESS_NAME } from "@/lib/config";
import { DELIVERY_TEMPLATES, type TemplateKey } from "@/lib/delivery-templates";
import { NOT_CURRENT_STOP, isCurrentStop, isCurrentStopFor } from "@/lib/delivery-stops";
import { hasAnyStop, isMyStop } from "@/lib/drivers";
import { recordStage, type Stage } from "@/lib/delivery-stages";

export type DeliveryResult = { ok: boolean; message: string };

/** Delivery, Owner and Secretary. Template texts only: the body always comes from the approved list, never the browser. */
export async function sendTemplateAction(orderId: number, key: TemplateKey): Promise<DeliveryResult> {
  const staff = await requireStaff(["owner", "secretary", "delivery"]);
  const t = DELIVERY_TEMPLATES[key];
  if (!t) return { ok: false, message: "Choose an approved message." };
  const full = await getOrderWithItems(orderId);
  const textTo = full ? full.order.textPhone || full.customer?.phone : null; // the order's text number (Nov 25, 2026)
  if (!full?.customer || !textTo) return { ok: false, message: "No customer phone on this order." };
  // Delivery staff (Abraham U): only for an order that is one of their current stops (delivery or pickup today,
  // or yesterday's late stop), and only to that order's own phone number (taken from the order, never the browser).
  if (staff.role === "delivery" && (!isCurrentStop(full.order) || !hasAnyStop(full.order, staff.userId))) return { ok: false, message: "You can only text the customer of one of your own stops today." };
  // The stop's newest photo goes with the template as a picture text (Abraham, Nov 16, 2026); a link only Twilio uses
  const { desc, eq } = await import("drizzle-orm");
  const { deliveryPhotoLink } = await import("@/lib/signed-link");
  const [photo] = await db.select({ id: schema.deliveryPhotos.id }).from(schema.deliveryPhotos).where(eq(schema.deliveryPhotos.orderId, orderId)).orderBy(desc(schema.deliveryPhotos.createdAt)).limit(1);
  const r = await sendOrderText({
    phone: textTo,
    email: full.customer.email,
    subject: `${BUSINESS_NAME} order #${orderNumber(orderId)}`,
    body: t.body,
    mediaUrls: photo ? [deliveryPhotoLink(photo.id)] : [],
    orderId,
    customerId: full.customer.id,
    userId: staff.userId,
    event: `delivery_${key}`,
  });
  return { ok: r.texted || r.emailed, message: r.texted ? `Sent: ${t.label}${photo ? " (with the photo)" : ""}` : r.message };
}

/** Delivered (delivery stop) or Picked up (pickup stop). Audited. */
export async function markDoneAction(orderId: number, stop: "delivery" | "pickup"): Promise<DeliveryResult> {
  const staff = await requireStaff(["owner", "secretary", "delivery"]);
  const full = await getOrderWithItems(orderId);
  if (!full) return { ok: false, message: "Order not found." };
  // A Delivery login acts only on its own assigned stops (Abraham, Nov 12, 2026)
  if (staff.role === "delivery" && !isMyStop(full.order, stop, staff.userId)) return { ok: false, message: "This stop isn't assigned to you." };
  if (staff.role === "delivery" && !isCurrentStopFor(full.order, stop)) return { ok: false, message: NOT_CURRENT_STOP }; // Extra check H3
  const from = full.order.status;
  const ok = stop === "delivery" ? from === "CONFIRMED" : from === "DELIVERED";
  if (!ok) return { ok: false, message: stop === "delivery" ? "Only confirmed (paid) orders can be marked delivered." : "Mark it delivered first." };
  const to = stop === "delivery" ? "DELIVERED" : "PICKED_UP";
  await setOrderStatus(orderId, to);
  await recordStage(orderId, stop, stop === "delivery" ? "delivered" : "picked_up", staff.userId, null, staff.name);
  await db.insert(schema.auditLog).values({ userId: staff.userId, action: `delivery.${to.toLowerCase()}`, entityType: "order", entityId: String(orderId), before: { status: from }, after: { status: to } });
  revalidatePath("/admin/deliveries");
  return { ok: true, message: to === "DELIVERED" ? "Marked delivered." : "Marked picked up." };
}

/** A photo of the stop (Abraham, Nov 15, 2026), saved privately in Cloudflare R2. Same who-can rules as Delivered. */
export async function uploadPhotoAction(form: FormData): Promise<DeliveryResult> {
  const staff = await requireStaff(["owner", "secretary", "delivery"]);
  const orderId = Number(form.get("orderId"));
  const stop = form.get("stop") === "pickup" ? "pickup" : "delivery";
  const file = form.get("photo") as Blob | null;
  if (!orderId || !file) return { ok: false, message: "Choose a photo first." };
  const full = await getOrderWithItems(orderId);
  if (!full) return { ok: false, message: "Order not found." };
  if (staff.role === "delivery" && !isMyStop(full.order, stop, staff.userId)) return { ok: false, message: "This stop isn't assigned to you." };
  if (staff.role === "delivery" && !isCurrentStopFor(full.order, stop)) return { ok: false, message: NOT_CURRENT_STOP }; // Extra check H3
  try {
    const { saveDeliveryPhoto } = await import("@/lib/delivery-photos");
    const p = await saveDeliveryPhoto(orderId, stop, new Uint8Array(await file.arrayBuffer()), { userId: staff.userId, name: staff.name });
    await db.insert(schema.auditLog).values({ userId: staff.userId, action: "delivery.photo_added", entityType: "order", entityId: String(orderId), after: { stop, photoId: p.id, sizeBytes: p.sizeBytes } });
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  revalidatePath("/admin/deliveries");
  return { ok: true, message: "Photo saved." };
}

/** Out for delivery, Out for pickup, or Problem reported (with a note; the office is emailed). Audited. */
export async function stageAction(orderId: number, stop: "delivery" | "pickup", stage: Stage, note?: string): Promise<DeliveryResult> {
  const staff = await requireStaff(["owner", "secretary", "delivery"]);
  const full = await getOrderWithItems(orderId);
  if (!full) return { ok: false, message: "Order not found." };
  if (staff.role === "delivery" && !isMyStop(full.order, stop, staff.userId)) return { ok: false, message: "This stop isn't assigned to you." };
  if (staff.role === "delivery" && !isCurrentStopFor(full.order, stop)) return { ok: false, message: NOT_CURRENT_STOP }; // Extra check H3
  if (stage === "delivered" || stage === "picked_up") return markDoneAction(orderId, stop);
  try {
    await recordStage(orderId, stop, stage, staff.userId, note, staff.name);
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  await db.insert(schema.auditLog).values({ userId: staff.userId, action: `delivery.${stage}`, entityType: "order", entityId: String(orderId), after: { stop, stage, note: note ?? null } });
  revalidatePath("/admin/deliveries");
  return { ok: true, message: stage === "problem" ? "Problem reported. The office was told." : stage === "out_for_delivery" ? "Out for delivery." : "Out for pickup." };
}
