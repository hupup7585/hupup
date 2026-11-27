"use server";

import { ensurePriced, pricingProblem } from "@/lib/order-pricing";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
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
import { linkHoldMinutes } from "@/lib/settings";

export type ActionResult = { ok: boolean; message: string };

// Code audit M2: NEEDS_ATTENTION holds its items too (availability counts it), so moving it on is not a re-booking
const OCCUPYING: OrderStatus[] = ["HOLD", "PENDING_PAYMENT", "CONFIRMED", "DELIVERED", "NEEDS_ATTENTION"];

/** Deep check A2: this order was delivered at some point (its status history says so). */
async function wasDelivered(orderId: number): Promise<boolean> {
  const rows = (await db.execute(sql`SELECT 1 FROM order_status_history WHERE order_id = ${orderId} AND to_status IN ('DELIVERED', 'PICKED_UP') LIMIT 1`)).rows;
  return rows.length > 0;
}

export async function updateStatusAction(orderId: number, status: OrderStatus, reason = ""): Promise<ActionResult> {
  const staff = await requireAdmin();
  if (!ORDER_STATUSES.includes(status)) return { ok: false, message: "Unknown status" };
  const why = reason.trim().slice(0, 300);
  if (status === "CANCELLED" && !why) return { ok: false, message: "Please write the reason for cancelling." };
  const full = await getOrderWithItems(orderId);
  if (!full) return { ok: false, message: "Order not found" };
  // Hark's Admin list 5 (Nov 26, 2026): a delivered order is out with the customer; it can't be cancelled
  // Deep check A2 (Nov 27, 2026): also after the pickup, and never by moving it back to Confirmed first (any order that
  // was ever delivered, from its status history, can't be cancelled)
  if (status === "CANCELLED" && (["DELIVERED", "PICKED_UP"].includes(full.order.status) || (await wasDelivered(orderId)))) return { ok: false, message: "This order was already delivered, so it can't be cancelled. If it needs a refund or a change, handle it on the order (payments) and write a note." };
  // Hark's Admin list 4: "Needs staff attention" becomes Confirmed only after the whole order is checked again, locked
  if (full.order.status === "NEEDS_ATTENTION" && (status === "CONFIRMED" || status === "DELIVERED")) {
    const { confirmAttentionOrder } = await import("@/lib/late-payment");
    if (!(await confirmAttentionOrder(orderId))) return { ok: false, message: "Some items on this order are no longer free for its dates. Change the items or the date first, or cancel and refund." };
    if (status === "CONFIRMED") {
      await (await import("@/lib/status-history")).explainStatus(orderId, "CONFIRMED", why || "Confirmed by staff after checking the items are free again", staff.userId);
      await db.insert(schema.auditLog).values({ userId: staff.userId, action: "order.status", entityType: "order", entityId: String(orderId), before: { status: full.order.status }, after: { status, reason: why || null } });
      revalidatePath("/admin", "layout");
      return { ok: true, message: "Status updated" };
    }
  }
  const wasOccupying =
    OCCUPYING.includes(full.order.status) &&
    !(["HOLD", "PENDING_PAYMENT"].includes(full.order.status) && full.order.holdExpiresAt && full.order.holdExpiresAt < new Date());
  if (!wasOccupying && OCCUPYING.includes(status)) {
    // Re-activating an order: make sure the items are still free. Code audit M2 (Nov 24, 2026): the order's own
    // pickup day, and the check and the change in one locked step (the items and their shared groups locked in id
    // order, like a phone booking), so two staff can never both re-book the last unit.
    const ids = [...new Set(full.items.map((i) => i.productId))].sort((x, y) => x - y);
    const problem = await db.transaction(async (tx) => {
      for (const id of ids) await tx.execute(sql`SELECT id FROM products WHERE stock_group = (SELECT stock_group FROM products WHERE id = ${id}) ORDER BY id FOR UPDATE`);
      for (const id of ids) await tx.execute(sql`SELECT id FROM products WHERE id = ${id} FOR UPDATE`);
      for (const it of full.items) {
        const [p] = await tx.select().from(schema.products).where(eq(schema.products.id, it.productId));
        const free = await checkBookable(it.productId, p.quantity, full.order.eventDate, tx as never, full.order.pickupDate);
        if (free < it.qty) return `${it.name} is no longer available for ${dualDate(full.order.eventDate)} (${free} free).`;
      }
      await tx.update(schema.orders).set({ status, updatedAt: new Date(), ...(status === "CONFIRMED" || status === "DELIVERED" ? { holdExpiresAt: null } : {}) }).where(eq(schema.orders.id, orderId));
      return null;
    });
    if (problem) return { ok: false, message: problem };
  }
  await setOrderStatus(orderId, status, status === "CONFIRMED" || status === "DELIVERED" ? { holdExpiresAt: null } : {}, { reason: why || "Changed by staff in Admin", userId: staff.userId });
  await db.insert(schema.auditLog).values({ userId: staff.userId, action: "order.status", entityType: "order", entityId: String(orderId), before: { status: full.order.status }, after: { status, reason: why || null } });
  revalidatePath("/admin", "layout");
  return { ok: true, message: "Status updated" };
}

/** Code audit M6: the ways staff can record a payment by hand (the list on the order page) */
const RECORD_METHODS = ["cash", "check", "sola", "other"] as const;

export async function recordPaymentAction(orderId: number, amount: string, method: string): Promise<ActionResult> {
  const staff = await requireAdmin();
  const cents = parseMoneyToCents(amount);
  if (!cents) return { ok: false, message: "Enter an amount" };
  if (!RECORD_METHODS.includes(method as (typeof RECORD_METHODS)[number])) return { ok: false, message: "Choose how it was paid: cash, check, card (Sola) or other." };
  const r = await markPaid(orderId, cents, method);
  // Code audit M6: every payment recorded by hand is in the audit log (who, how much, how); confirmed only when paid in full
  if (r) await db.insert(schema.auditLog).values({ userId: staff.userId, action: "order.payment_recorded", entityType: "order", entityId: String(orderId), after: { cents, method, status: r.status } });
  revalidatePath("/admin", "layout");
  return r ? { ok: true, message: "Payment recorded" } : { ok: false, message: "Order not found" };
}

export async function sendPayLinkAction(orderId: number): Promise<ActionResult> {
  const session = await requireAdmin();
  // Hark's Admin list 7 (Nov 26, 2026): no payment link for a cancelled order
  const [st] = await db.select({ status: schema.orders.status }).from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
  if (st?.status === "CANCELLED") return { ok: false, message: "This order is cancelled, so no payment link can be sent. Book it again first if the customer still wants it." };
  if (!(await ensurePriced(orderId))) return { ok: false, message: (await pricingProblem(orderId)) ?? "This order could not be priced." };
  const full = await getOrderWithItems(orderId);
  if (!full) return { ok: false, message: "Order not found" };
  const phone = full.order.textPhone || full.customer?.phone; // the order's text number (Nov 25, 2026)
  if (!phone) return { ok: false, message: "This customer has no phone number" };
  const due = (full.order.totalCents ?? full.order.subtotalCents) - full.order.paidCents;
  if (due <= 0) return { ok: false, message: "Nothing left to pay" };
  const link = payPageLink(orderId); // review-and-pay page: Terms box, then Sola
  if (full.order.status === "PENDING_PAYMENT") {
    await setOrderStatus(orderId, "PENDING_PAYMENT", { holdExpiresAt: minutesFromNow(await linkHoldMinutes("admin")) /* Abraham, Nov 25, 2026, 12:13: Admin links hold 25, like New booking */, linkHoldKind: "admin" });
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
  const staff = await requireAdmin();
  const [before] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
  if (!before) return { ok: false, message: "Not saved. Order not found." };
  const deliveryAddress = String(form.get("deliveryAddress") || "").trim() || null;
  const notes = String(form.get("notes") || "") || null;
  const moved = (before.deliveryAddress ?? null) !== deliveryAddress;
  // Audit H2 (Nov 24, 2026): a new address on an order nothing has been paid on is priced again (zone, delivery, tax,
  // total), so the next payment link charges the new amount. Paid or finished orders keep their price.
  const reprice = moved && before.paidCents === 0 && !["CANCELLED", "DELIVERED", "PICKED_UP"].includes(before.status);
  await db
    .update(schema.orders)
    .set({
      deliveryAddress,
      notes,
      ...(reprice ? { totalCents: null, deliveryFeeCents: 0, taxCents: 0, deliveryZone: null } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.orders.id, orderId));
  let problem: string | null = null;
  if (reprice && !(await ensurePriced(orderId))) problem = (await pricingProblem(orderId)) ?? "This order could not be priced.";
  const [after] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
  const pick = (o: typeof before) => ({ deliveryAddress: o.deliveryAddress, notes: o.notes, deliveryZone: o.deliveryZone, deliveryFeeCents: o.deliveryFeeCents, taxCents: o.taxCents, totalCents: o.totalCents });
  await db.insert(schema.auditLog).values({ userId: staff.userId ?? null, action: "order.details", entityType: "order", entityId: String(orderId), before: pick(before), after: pick(after) });
  revalidatePath("/admin", "layout");
  if (problem) return { ok: false, message: `Saved, but no payment link can be sent: ${problem}` };
  if (moved && !reprice && before.paidCents > 0) return { ok: true, message: "Saved. Payment was already taken, so the price did not change." };
  return { ok: true, message: "Saved" };
}

