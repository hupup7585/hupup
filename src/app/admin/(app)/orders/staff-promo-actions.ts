"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getOrderWithItems } from "@/lib/orders";
import { formatPhone } from "@/lib/phone";
import { logStamp, tenDigitNumber } from "@/lib/phone-promo";
import { requestPromoConfirmation } from "@/lib/sms-reenroll";
import { promoConfirmRequestSms } from "@/lib/sms-terms-v2";
import { TEXTING_NOT_ACTIVE, sendMessage } from "@/lib/sms";
import { STAFF_PROMO_STEP1, staffPromoStep2, staffPromoVisible } from "@/lib/staff-promo";

export type StaffPromoResult = { ok: boolean; sent: boolean; message: string };

/**
 * Staff promo sign-up: the customer said yes to Step 1, staff confirmed or typed the number in Step 2, then pressed
 * Send confirmation. Texts the approved confirmation (word for word) and logs source staff, the staff member's name,
 * the number used, and the date, time and year. Nothing is signed up until the customer replies YES within 24 hours.
 */
export async function staffPromoSignupAction(
  orderId: number,
  form: { saidYes: boolean; useCustomerNumber: boolean; otherNumber?: string },
): Promise<StaffPromoResult> {
  const staff = await requireAdmin();
  if (!staffPromoVisible(staff.role)) return { ok: false, sent: false, message: "Your account can't send promo sign-ups yet." };
  if (!form.saidYes) return { ok: false, sent: false, message: "Mark that the customer said yes first." };

  const full = await getOrderWithItems(orderId);
  const customerPhone = full?.customer?.phone ?? null;
  const typed = (form.otherNumber ?? "").replace(/\D/g, ""); // staff may type dashes, spaces or brackets
  const to = form.useCustomerNumber ? customerPhone : tenDigitNumber(typed);
  if (!to) return { ok: false, sent: false, message: form.useCustomerNumber ? "This order has no customer phone number." : "Type a 10-digit mobile number." };

  const usedCustomer = form.useCustomerNumber;
  const how =
    `staff: ${staff.name} (user ${staff.userId ?? "owner"}) on order ${orderId}; customer said yes to: "${STAFF_PROMO_STEP1}"; ` +
    `asked: "${staffPromoStep2(customerPhone ?? to)}"; number used: ${usedCustomer ? "the customer's number" : "a different number"} ${to}; ${logStamp()}`;
  const r = await db.transaction(async (tx) => {
    const [c] = await tx.select().from(schema.customers).where(eq(schema.customers.phone, to)).limit(1).for("update");
    return requestPromoConfirmation(tx, c ?? null, to, how);
  });
  const [cust] = await db.select({ id: schema.customers.id }).from(schema.customers).where(eq(schema.customers.phone, to)).limit(1);
  const res = r.sendConfirmation ? await sendMessage({ to, body: promoConfirmRequestSms(), kind: "system", event: "promo_confirm_request", customerId: cust?.id ?? null, orderId }) : null;
  const delivered = Boolean(res?.sent);
  await db.insert(schema.auditLog).values({
    userId: staff.userId ?? null,
    action: "sms_consent.staff_promo_requested",
    entityType: "customer",
    entityId: cust ? String(cust.id) : to,
    after: { orderId, staffName: staff.name, numberUsed: to, which: usedCustomer ? "customer" : "different", result: r.reason, textSent: delivered, at: logStamp() },
  });
  revalidatePath(`/admin/orders/${orderId}`);
  const why: Record<string, string> = {
    pending_created: `Confirmation text sent to ${formatPhone(to)}. Read Step 3 to the customer.`,
    already_pending: `A confirmation text is already waiting for a YES from ${formatPhone(to)}. Nothing new was sent.`,
    already_enrolled: `${formatPhone(to)} is already signed up for promo texts. Nothing was sent.`,
    opted_out: `${formatPhone(to)} replied STOP, so no text can be sent.`,
  };
  if (r.sendConfirmation && !delivered) return { ok: false, sent: false, message: `Not sent: ${TEXTING_NOT_ACTIVE}. The request is saved, so don't read Step 3 yet.` };
  return { ok: r.sendConfirmation, sent: delivered, message: why[r.reason] ?? r.reason };
}

/** The customer said no to Step 1: nothing is signed up or sent; the answer is kept in the audit log. */
export async function staffPromoNoAction(orderId: number): Promise<StaffPromoResult> {
  const staff = await requireAdmin();
  if (!staffPromoVisible(staff.role)) return { ok: false, sent: false, message: "Your account can't send promo sign-ups yet." };
  await db.insert(schema.auditLog).values({
    userId: staff.userId ?? null,
    action: "sms_consent.staff_promo_declined",
    entityType: "order",
    entityId: String(orderId),
    after: { staffName: staff.name, at: logStamp() },
  });
  return { ok: true, sent: false, message: "Saved: customer said no. Nothing was sent." };
}
