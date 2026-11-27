import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/**
 * The seasonal offers sign-up confirmation text (Abraham, Nov 27, 2026: approved word for word, switched on).
 * Sent once, right away, when a number joins the seasonal offers: phone Line 8 press 1, a JOIN text reply, or the
 * website sign-up box (confirmed with YES). It goes out on Shabbes too (the customer asked for it). A number that was
 * already signed up, or that already got this text, never gets a second one. The Owner can edit the wording in Admin,
 * Hotline prompts, Texts and emails ("msg_seasonal_join_confirm").
 */
export const SEASONAL_JOIN_CONFIRM_TEXT =
  "Hup Up Attractions: You have joined our seasonal offers. You will never miss a deal, special, or new rentals, with up to 5 messages a year. Message and data rates may apply. Reply STOP to stop, or HELP for help.";
export const SEASONAL_JOIN_CONFIRM_EVENT = "seasonal_join_confirm";

/** Did this number already get the sign-up confirmation (one that was not blocked or failed)? */
export async function gotSeasonalJoinConfirm(phone: string): Promise<boolean> {
  const [m] = await db
    .select({ id: schema.messages.id })
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.toNumber, phone),
        eq(schema.messages.direction, "out"),
        eq(schema.messages.event, SEASONAL_JOIN_CONFIRM_EVENT),
        sql`${schema.messages.status} not in ('blocked', 'failed', 'undelivered', 'canceled')`,
      ),
    )
    .limit(1);
  return Boolean(m);
}

/** The text as it goes out: the Owner's edited wording from Admin, or the approved wording. */
export async function seasonalJoinConfirmText(): Promise<string> {
  const { messageText } = await import("@/lib/ivr/prompts");
  return (await messageText("msg_seasonal_join_confirm")).trim() || SEASONAL_JOIN_CONFIRM_TEXT;
}

/**
 * Sends the confirmation once. `alreadySignedUp` = the number was signed up before this join (no text then).
 * Returns whether a text was sent.
 */
export async function sendSeasonalJoinConfirm(phone: string, o: { customerId?: number | null; callSid?: string | null; alreadySignedUp?: boolean } = {}): Promise<boolean> {
  if (o.alreadySignedUp) return false;
  if (await gotSeasonalJoinConfirm(phone)) return false;
  const { sendMessage } = await import("@/lib/sms");
  const r = await sendMessage({ to: phone, body: await seasonalJoinConfirmText(), kind: "system", event: SEASONAL_JOIN_CONFIRM_EVENT, customerId: o.customerId ?? null, callSid: o.callSid ?? null });
  return r.sent;
}
