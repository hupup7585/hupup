import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { PROMOS_PER_YEAR } from "@/lib/sms-consent-copy";
import { hasTransactionalConsent, inMarketingHours, sendMessage } from "@/lib/sms";

/**
 * JOIN invitation (Abraham, Nov 10, 2026): one separate text per customer, never inside an order text, inviting
 * them to reply JOIN. A JOIN reply only requests the approved confirmation text; YES within 24 hours signs up.
 *
 * Built and SWITCHED OFF. Abraham chooses the exact wording before it is turned on. The yearly number always comes
 * from PROMOS_PER_YEAR, the same number the phone line and the confirmation text use.
 */
export const JOIN_INVITE_ON = false;

/** Draft only (Abraham's earlier line); he picks the final wording before JOIN_INVITE_ON is set to true. */
export const JOIN_INVITE_DRAFT = "Hup Up Attractions: Want seasonal offers and updates? Reply JOIN for up to {n} promo texts a year.";
export const JOIN_INVITE_EVENT = "join_invite";

export function joinInviteText(template = JOIN_INVITE_DRAFT): string {
  return template.replace("{n}", String(PROMOS_PER_YEAR));
}

type Candidate = { id: number; phone: string; smsOptOut: boolean; marketingOptIn: boolean; isTest: boolean; timeZone: string | null };

/** Who may get the invitation: order-text consent, a confirmed or finished order, not on promos, no STOP, not a test entry, never invited. */
export async function joinInviteEligible(c: Candidate): Promise<boolean> {
  if (c.smsOptOut || c.marketingOptIn || c.isTest) return false;
  if (!(await hasTransactionalConsent(c.phone))) return false;
  const [invited] = await db
    .select({ id: schema.messages.id })
    .from(schema.messages)
    .where(and(eq(schema.messages.contactPhone, c.phone), eq(schema.messages.event, JOIN_INVITE_EVENT)))
    .limit(1);
  if (invited) return false;
  const [pending] = await db
    .select({ id: schema.smsReenrollRequests.id })
    .from(schema.smsReenrollRequests)
    .where(and(eq(schema.smsReenrollRequests.phone, c.phone), eq(schema.smsReenrollRequests.scope, "marketing"), eq(schema.smsReenrollRequests.status, "pending")))
    .limit(1);
  return !pending;
}

/**
 * Daily job: send the invitation to eligible customers, once each, only during promo hours. Does nothing while
 * JOIN_INVITE_ON is false.
 */
export async function sendJoinInvites(now = new Date(), on = JOIN_INVITE_ON, template = JOIN_INVITE_DRAFT): Promise<{ on: boolean; sent: number; skipped: number }> {
  if (!on) return { on: false, sent: 0, skipped: 0 };
  const rows = await db
    .selectDistinct({
      id: schema.customers.id,
      phone: schema.customers.phone,
      smsOptOut: schema.customers.smsOptOut,
      marketingOptIn: schema.customers.marketingOptIn,
      isTest: schema.customers.isTest,
      timeZone: schema.customers.timeZone,
    })
    .from(schema.customers)
    .innerJoin(schema.orders, eq(schema.orders.customerId, schema.customers.id))
    .where(and(isNotNull(schema.customers.phone), inArray(schema.orders.status, ["CONFIRMED", "DELIVERED", "PICKED_UP"])));
  let sent = 0;
  let skipped = 0;
  for (const r of rows) {
    const c = { ...r, phone: r.phone as string };
    if (!(await joinInviteEligible(c)) || !inMarketingHours(c.phone, now, c.timeZone)) {
      skipped++;
      continue;
    }
    const res = await sendMessage({ to: c.phone, body: joinInviteText(template), kind: "system", event: JOIN_INVITE_EVENT, customerId: c.id, now });
    if (res.sent) sent++;
    else skipped++;
  }
  return { on: true, sent, skipped };
}
