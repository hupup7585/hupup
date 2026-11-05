import { and, eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import { recordConsentDetailed, type Exec } from "@/lib/sms-consent";
import { REENROLL_WINDOW_HOURS, START_CONFIRMATION_SMS, START_CONFIRMATION_VERSION } from "@/lib/sms-consent-copy";

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

async function activePending(tx: Exec, phone: string, now: Date) {
  const rows = await tx.select().from(schema.smsReenrollRequests).where(and(eq(schema.smsReenrollRequests.phone, phone), eq(schema.smsReenrollRequests.status, "pending")));
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
export async function handleYes(tx: Exec, customer: Customer | null, phone: string, text: string, now = new Date()): Promise<{ confirmed: boolean; reason: string }> {
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
  return { confirmed: true, reason: "confirmed" };
}

/** STOP: cancel any pending START confirmation for this number. */
export async function cancelPendingReenroll(tx: Exec, phone: string, now = new Date(), reason = "stop") {
  await tx
    .update(schema.smsReenrollRequests)
    .set({ status: "canceled", resolvedAt: now, resolution: reason })
    .where(and(eq(schema.smsReenrollRequests.phone, phone), eq(schema.smsReenrollRequests.status, "pending")));
}
