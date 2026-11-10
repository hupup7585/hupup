"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getOrderWithItems } from "@/lib/orders";
import { formatPhone } from "@/lib/phone";
import { ConsentBlockedError, recordStaffConsent, type ConsentScope, type StaffResponse } from "@/lib/sms-consent";
import { STAFF_CONSENT_VERSION } from "@/lib/sms-consent-copy";
import { promoConfirmRequestSms, smsTermsV2Active, staffDisclosure } from "@/lib/sms-terms-v2";
import { requestPromoConfirmation } from "@/lib/sms-reenroll";
import { sendMessage } from "@/lib/sms";

export type ConsentActionResult = { ok: boolean; message: string };

/**
 * Staff record a customer's text-message consent after reading the entire disclosure aloud.
 * Restricted to signed-in Owner/Secretary accounts (not Delivery). Every attempt is written to the audit log.
 */
export async function recordStaffConsentAction(orderId: number, form: { scope: ConsentScope; response: StaffResponse; disclosureRead: boolean; timeZone?: string }): Promise<ConsentActionResult> {
  const session = await requireAdmin();
  if (session.userId) {
    const [user] = await db.select({ role: schema.adminUsers.role, active: schema.adminUsers.active }).from(schema.adminUsers).where(eq(schema.adminUsers.id, session.userId)).limit(1);
    if (!user?.active || user.role === "delivery") return { ok: false, message: "Your account can't record text consent." };
  }
  if (form.scope !== "transactional" && form.scope !== "marketing") return { ok: false, message: "Choose which texts." };
  // Promo texts use the short three-step sign-up (Promo texts sign-up box); the long read-aloud is retired (Abraham).
  if (form.scope === "marketing" && smsTermsV2Active()) return { ok: false, message: "Use the Promo texts sign-up box for promo texts." };
  if (!["clear_yes", "said_no", "unclear_or_silent"].includes(form.response)) return { ok: false, message: "Choose the customer's answer." };
  if (form.response === "clear_yes" && !form.disclosureRead) return { ok: false, message: "Read the entire disclosure to the customer, then check the box, before recording a yes." };

  const full = await getOrderWithItems(orderId);
  const phone = full?.customer?.phone;
  if (!phone) return { ok: false, message: "This order has no customer phone number." };

  const wording = staffDisclosure()[form.scope].replace("{phone}", formatPhone(phone));
  // SMS Terms v2: a spoken yes to promotions is not written consent. Staff only trigger the confirmation text;
  // the customer is enrolled when they reply YES to it.
  if (smsTermsV2Active() && form.scope === "marketing" && form.response === "clear_yes") {
    const how = `staff user ${session.userId ?? "?"} on order ${orderId} after reading: ${wording}`;
    const r = await db.transaction(async (tx) => {
      const [c] = await tx.select().from(schema.customers).where(eq(schema.customers.phone, phone)).limit(1).for("update");
      return requestPromoConfirmation(tx, c ?? null, phone, how);
    });
    if (r.sendConfirmation) await sendMessage({ to: phone, body: promoConfirmRequestSms(), kind: "system", event: "promo_confirm_request", customerId: full!.customer!.id, orderId });
    await db.insert(schema.auditLog).values({
      userId: session.userId ?? null,
      action: "sms_consent.promo_confirmation_requested",
      entityType: "customer",
      entityId: String(full!.customer!.id),
      after: { orderId, result: r.reason },
    });
    revalidatePath(`/admin/orders/${orderId}`);
    const why: Record<string, string> = {
      pending_created: "Confirmation text sent. The customer is signed up for promotional texts only after they reply YES to it.",
      already_pending: "A confirmation text is already waiting for the customer's YES reply.",
      already_enrolled: "This customer is already signed up for promotional texts.",
      opted_out: "This number replied STOP, so no confirmation text can be sent.",
    };
    return { ok: r.reason !== "opted_out", message: why[r.reason] ?? r.reason };
  }
  try {
    await recordStaffConsent({
    phone,
    scope: form.scope,
    response: form.response,
    disclosureRead: form.disclosureRead,
    wording,
    wordingVersion: STAFF_CONSENT_VERSION,
    userId: session.userId ?? null,
    orderId,
    timeZone: form.timeZone || null,
  });
  } catch (e) {
    // e.g. the customer replied STOP: staff can't override it. The attempt is audited.
    if (!(e instanceof Error)) throw e;
    await db.insert(schema.auditLog).values({
      userId: session.userId ?? null,
      action: e instanceof ConsentBlockedError ? "sms_consent.staff_blocked" : "sms_consent.staff_error",
      entityType: "customer",
      entityId: String(full!.customer!.id),
      after: { scope: form.scope, response: form.response, disclosureRead: form.disclosureRead, orderId, reason: e.message },
    });
    return { ok: false, message: e.message };
  }

  const h = await headers();
  await db.insert(schema.auditLog).values({
    userId: session.userId ?? null,
    action: "sms_consent.staff_recorded",
    entityType: "customer",
    entityId: String(full!.customer!.id),
    after: { scope: form.scope, response: form.response, disclosureRead: form.disclosureRead, orderId, version: STAFF_CONSENT_VERSION },
    ip: (h.get("x-forwarded-for") || "").split(",")[0].trim() || null,
    userAgent: h.get("user-agent")?.slice(0, 500) ?? null,
  });
  revalidatePath(`/admin/orders/${orderId}`);
  const label = form.scope === "marketing" ? "promotional texts" : "order texts";
  return { ok: true, message: form.response === "clear_yes" ? `Recorded: customer agreed to ${label}.` : `Recorded: no consent for ${label}.` };
}
