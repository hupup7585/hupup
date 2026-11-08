import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { toE164 } from "@/lib/phone";
import { sendMessage } from "@/lib/sms";
import { ConsentBlockedError, MARKETING_CONFIRMATION_SMS, TRANSACTIONAL_CONFIRMATION_SMS, recordConsent } from "@/lib/sms-consent";
import { webConsentCopy } from "@/lib/sms-terms-v2";

/**
 * Text consent boxes on the pay page and the staff New booking screen (Abraham, approved): two separate boxes, both
 * unchecked, with the same approved wording as /text-alerts. Each checked box is saved the same way as the other
 * consents (exact wording and version, date and time, method, and IP or staff member) and gets the same
 * confirmation text. Promotional consent is never required to book or pay. A number that replied STOP isn't changed.
 */
export type BookingConsentInput = {
  phone: string | null | undefined;
  transactional: boolean;
  marketing: boolean;
  source: "web" | "pos";
  orderId?: number | null;
  ip?: string | null;
  userAgent?: string | null;
  pageUrl?: string | null;
  userId?: number | null;
};

export async function recordBookingConsents(input: BookingConsentInput): Promise<{ saved: ("transactional" | "marketing")[]; stopped: boolean }> {
  const phone = toE164(input.phone ?? "");
  const saved: ("transactional" | "marketing")[] = [];
  if (!phone || (!input.transactional && !input.marketing)) return { saved, stopped: false };
  const [c] = await db.select().from(schema.customers).where(eq(schema.customers.phone, phone)).limit(1);
  if (c?.smsOptOut) return { saved, stopped: true }; // only START + YES can re-enroll a number that replied STOP
  const copy = webConsentCopy();
  const base = {
    phone,
    source: input.source,
    method: input.source === "web" ? ("checkbox" as const) : ("staff" as const),
    wordingVersion: copy.version,
    response: input.source === "web" ? "checked" : "staff checked the box after reading the wording to the customer",
    orderId: input.orderId ?? null,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
    pageUrl: input.pageUrl ?? null,
    userId: input.userId ?? null,
    disclosureRead: input.source === "pos" ? true : null,
  };
  let customerId = c?.id ?? null;
  try {
    if (input.transactional) {
      customerId = await recordConsent({ ...base, scope: "transactional", action: "opt_in", wording: copy.transactional });
      saved.push("transactional");
    }
    if (input.marketing) {
      customerId = await recordConsent({ ...base, scope: "marketing", action: "opt_in", wording: copy.marketing });
      saved.push("marketing");
    }
  } catch (e) {
    if (e instanceof ConsentBlockedError) return { saved, stopped: true };
    throw e;
  }
  // One confirmation text per program joined (non-promotional), same as the /text-alerts sign-up
  if (saved.includes("transactional")) await sendMessage({ to: phone, body: TRANSACTIONAL_CONFIRMATION_SMS, kind: "system", event: "consent_confirmation", customerId, orderId: input.orderId ?? null });
  if (saved.includes("marketing")) await sendMessage({ to: phone, body: MARKETING_CONFIRMATION_SMS, kind: "system", event: "consent_confirmation", customerId, orderId: input.orderId ?? null });
  return { saved, stopped: false };
}
