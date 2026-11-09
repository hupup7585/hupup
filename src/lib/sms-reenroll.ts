import { and, eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import { recordConsentDetailed, type Exec } from "@/lib/sms-consent";
import { REENROLL_WINDOW_HOURS, START_CONFIRMATION_SMS, START_CONFIRMATION_VERSION } from "@/lib/sms-consent-copy";
import { promoConfirmRequestSms, PROMO_CONFIRM_VERSION, PROMO_CONFIRM_WINDOW_HOURS } from "@/lib/sms-terms-v2";

/**
 * START -> YES re-enrollment (order/service texts only). Every function runs inside the caller's transaction,
 * which has already locked the customer row, so a STOP and a YES for the same number can't interleave.
 *
 *  START  (number opted out)  -> one pending confirmation for 24 hours + the START confirmation text.
 *  YES    (active pending)    -> new order/service consent; block lifted; request confirmed.
 *  STOP   (pending)           -> request canceled; a late YES does nothing.
 *  YES with no active pending, or START from a number that isn't opted out -> nothing.
 */

type Customer = typeof schema.customers.$inferSelect;

async function activePending(tx: Exec, phone: string, now: Date, scope: "transactional" | "marketing" = "transactional") {
  const rows = await tx
    .select()
    .from(schema.smsReenrollRequests)
    .where(and(eq(schema.smsReenrollRequests.phone, phone), eq(schema.smsReenrollRequests.status, "pending"), eq(schema.smsReenrollRequests.scope, scope)));
  let active: (typeof rows)[number] | null = null;
  for (const r of rows) {
    if (r.expiresAt.getTime() > now.getTime()) active = r;
    else await tx.update(schema.smsReenrollRequests).set({ status: "expired", resolvedAt: now, resolution: "expired" }).where(eq(schema.smsReenrollRequests.id, r.id));
  }
  return active;
}

/** Returns whether a new confirmation text should be sent (false for ineligible numbers and repeated STARTs). */
export async function handleStart(tx: Exec, customer: Customer | null, phone: string, text: string, now = new Date()): Promise<{ sendConfirmation: boolean; reason: string }> {
  if (!customer?.smsOptOut) return { sendConfirmation: false, reason: "not_opted_out" };
  if (await activePending(tx, phone, now)) return { sendConfirmation: false, reason: "already_pending" };
  await tx.insert(schema.smsReenrollRequests).values({
    phone,
    customerId: customer.id,
    scope: "transactional",
    status: "pending",
    promptText: START_CONFIRMATION_SMS,
    startMessage: text,
    requestedAt: now,
    expiresAt: new Date(now.getTime() + REENROLL_WINDOW_HOURS * 3600 * 1000),
  });
  return { sendConfirmation: true, reason: "pending_created" };
}

/** YES: restores order/service consent only if an active START confirmation exists. */
export async function handleYes(
  tx: Exec,
  customer: Customer | null,
  phone: string,
  text: string,
  now = new Date(),
): Promise<{ confirmed: boolean; reason: string; scope?: "transactional" | "marketing" }> {
  if (customer && !customer.smsOptOut) return handlePromoYes(tx, customer, phone, text, now);
  if (!customer?.smsOptOut) return { confirmed: false, reason: "not_opted_out" };
  const pending = await activePending(tx, phone, now);
  if (!pending) return { confirmed: false, reason: "no_active_confirmation" };
  // Lift the block first (same transaction) so the new consent can be recorded; promotions stay off.
  await tx.update(schema.customers).set({ smsOptOut: false }).where(eq(schema.customers.id, customer.id));
  const { consentId } = await recordConsentDetailed(
    {
      phone,
      scope: "transactional",
      action: "opt_in",
      source: "keyword",
      method: "keyword",
      wording: pending.promptText,
      wordingVersion: START_CONFIRMATION_VERSION,
      response: `texted "${text.trim()}" to the START confirmation sent ${pending.requestedAt.toISOString()}`,
      viaStartConfirmation: true,
    },
    tx,
  );
  await tx
    .update(schema.smsReenrollRequests)
    .set({ status: "confirmed", resolvedAt: now, resolution: `consent ${consentId}`, confirmConsentId: consentId })
    .where(eq(schema.smsReenrollRequests.id, pending.id));
  return { confirmed: true, reason: "confirmed", scope: "transactional" };
}

/**
 * SMS Terms v2: written promotional consent. A phone keypress or a staff-recorded yes only creates this pending
 * request and texts PROMO_CONFIRM_REQUEST_SMS; the number is enrolled only when it replies YES within the window.
 * Returns whether the confirmation text should be sent (not for opted-out numbers, people already enrolled, or a
 * request that is still waiting).
 */
export async function requestPromoConfirmation(
  tx: Exec,
  customer: Customer | null,
  phone: string,
  how: string,
  now = new Date(),
): Promise<{ sendConfirmation: boolean; reason: string }> {
  if (customer?.smsOptOut) return { sendConfirmation: false, reason: "opted_out" };
  if (customer?.marketingOptIn) return { sendConfirmation: false, reason: "already_enrolled" };
  if (await activePending(tx, phone, now, "marketing")) return { sendConfirmation: false, reason: "already_pending" };
  await tx.insert(schema.smsReenrollRequests).values({
    phone,
    customerId: customer?.id ?? null,
    scope: "marketing",
    status: "pending",
    promptText: promoConfirmRequestSms(),
    startMessage: how,
    requestedAt: now,
    expiresAt: new Date(now.getTime() + PROMO_CONFIRM_WINDOW_HOURS * 3600 * 1000),
  });
  return { sendConfirmation: true, reason: "pending_created" };
}

export async function handlePromoYes(tx: Exec, customer: Customer, phone: string, text: string, now: Date) {
  const pending = await activePending(tx, phone, now, "marketing");
  if (!pending) return { confirmed: false, reason: "no_active_confirmation" };
  const { consentId } = await recordConsentDetailed(
    {
      phone,
      scope: "marketing",
      action: "opt_in",
      source: "sms_reply",
      method: "sms_reply",
      wording: pending.promptText,
      wordingVersion: PROMO_CONFIRM_VERSION,
      response: `texted "${text.trim()}" to the promotional confirmation sent ${pending.requestedAt.toISOString()} (requested by ${pending.startMessage ?? "unknown"})`,
      viaPromoConfirmation: true,
    },
    tx,
  );
  await tx
    .update(schema.smsReenrollRequests)
    .set({ status: "confirmed", resolvedAt: now, resolution: `consent ${consentId}`, confirmConsentId: consentId })
    .where(eq(schema.smsReenrollRequests.id, pending.id));
  return { confirmed: true, reason: "confirmed", scope: "marketing" as const };
}

/** STOP: cancel any pending START confirmation for this number. */
export async function cancelPendingReenroll(tx: Exec, phone: string, now = new Date(), reason = "stop") {
  await tx
    .update(schema.smsReenrollRequests)
    .set({ status: "canceled", resolvedAt: now, resolution: reason })
    .where(and(eq(schema.smsReenrollRequests.phone, phone), eq(schema.smsReenrollRequests.status, "pending")));
}
