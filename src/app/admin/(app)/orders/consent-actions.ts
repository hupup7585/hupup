"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getOrderWithItems } from "@/lib/orders";
import { formatPhone } from "@/lib/phone";
import { recordStaffConsent, type ConsentScope, type StaffResponse } from "@/lib/sms-consent";
import { STAFF_CONSENT_VERSION, STAFF_DISCLOSURE } from "@/lib/sms-consent-copy";

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
  if (!["clear_yes", "said_no", "unclear_or_silent"].includes(form.response)) return { ok: false, message: "Choose the customer's answer." };
  if (form.response === "clear_yes" && !form.disclosureRead) return { ok: false, message: "Read the entire disclosure to the customer, then check the box, before recording a yes." };

  const full = await getOrderWithItems(orderId);
  const phone = full?.customer?.phone;
  if (!phone) return { ok: false, message: "This order has no customer phone number." };

  const wording = STAFF_DISCLOSURE[form.scope].replace("{phone}", formatPhone(phone));
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
