import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { PROMOS_PER_YEAR } from "@/lib/sms-consent-copy";
import { marketingBody, promosThisYear, sendMessage } from "@/lib/sms";
import { textingActive } from "@/lib/voicemail";

/**
 * Seasonal promo campaigns (Abraham, Nov 9, 2026).
 * - The Owner writes the wording and approves it; the Secretary can only send approved campaigns.
 * - Only customers who signed up for promos (and didn't reply STOP or NO PROMO) get them, at most 6 a year.
 * - Every text goes through sendMessage, which rechecks consent, the yearly limit and quiet hours at the moment of sending.
 */
export type Campaign = typeof schema.smsCampaigns.$inferSelect;

/** Texting can actually go out (A2P approved), or this isn't the live site. */
export const campaignsCanSend = (env: Record<string, string | undefined> = process.env) => textingActive(env) || env.VERCEL_ENV !== "production";
export const CAMPAIGNS_NOT_ACTIVE = "Not active yet: waiting for Twilio A2P approval";

/** GSM-7 text: 160 characters in one segment, 153 per segment after that (anything else: 70 / 67). */
export function segments(text: string): { chars: number; segments: number } {
  const gsm = /^[\x20-\x7E\n\r£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ¤¡ÄÖÑÜ§¿äöñüà€]*$/.test(text);
  const [one, many] = gsm ? [160, 153] : [70, 67];
  return { chars: text.length, segments: text.length <= one ? 1 : Math.ceil(text.length / many) };
}

export type PromoSignup = {
  customerId: number;
  name: string | null;
  phone: string;
  signedUpAt: Date | null;
  source: string | null;
  thisYear: number;
  status: "Active" | "At yearly limit" | "Stopped all texts";
};

/** Everyone signed up for promos, with their status and how many promos they got this year. */
export async function promoSignups(now = new Date()): Promise<PromoSignup[]> {
  const rows = await db
    .select()
    .from(schema.customers)
    .where(and(eq(schema.customers.marketingOptIn, true), isNotNull(schema.customers.phone)))
    .orderBy(desc(schema.customers.marketingOptInAt));
  const out: PromoSignup[] = [];
  for (const c of rows) {
    const [src] = await db
      .select({ source: schema.smsConsents.source })
      .from(schema.smsConsents)
      .where(and(eq(schema.smsConsents.phone, c.phone!), eq(schema.smsConsents.scope, "marketing"), eq(schema.smsConsents.action, "opt_in")))
      .orderBy(desc(schema.smsConsents.createdAt))
      .limit(1);
    const thisYear = await promosThisYear(c.phone!, now);
    out.push({
      customerId: c.id,
      name: c.name,
      phone: c.phone!,
      signedUpAt: c.marketingOptInAt,
      source: src?.source ?? null,
      thisYear,
      status: c.smsOptOut ? "Stopped all texts" : thisYear >= PROMOS_PER_YEAR ? "At yearly limit" : "Active",
    });
  }
  return out;
}

export const eligibleOf = (list: PromoSignup[]) => list.filter((s) => s.status === "Active");

export async function listCampaigns(): Promise<Campaign[]> {
  return db.select().from(schema.smsCampaigns).orderBy(desc(schema.smsCampaigns.createdAt));
}

async function audit(userId: number | null, action: string, id: number, after: Record<string, unknown>) {
  await db.insert(schema.auditLog).values({ userId, action, entityType: "sms_campaign", entityId: String(id), after });
}

/** Owner: a new campaign (draft). The wording is checked for length and card numbers when it's sent. */
export async function createCampaign(input: { name: string; body: string }, userId: number | null): Promise<Campaign> {
  const name = input.name.replace(/\s+/g, " ").trim().slice(0, 80);
  const body = input.body.replace(/\s+/g, " ").trim();
  if (!name) throw new Error("Give the campaign a name, like 'Summer 2027'.");
  if (body.length < 10) throw new Error("Write the offer (at least a few words).");
  if (body.length > 600) throw new Error("That's too long for a text. Keep it under 600 characters.");
  const [c] = await db.insert(schema.smsCampaigns).values({ name, body, createdBy: userId }).returning();
  await audit(userId, "campaign.created", c.id, { name, body });
  return c;
}

/** Owner: approve the wording. Only approved campaigns can be sent (by the Owner or the Secretary). */
export async function approveCampaign(id: number, userId: number | null) {
  const [c] = await db.update(schema.smsCampaigns).set({ status: "approved", approvedBy: userId, approvedAt: new Date() }).where(and(eq(schema.smsCampaigns.id, id), eq(schema.smsCampaigns.status, "draft"))).returning();
  if (!c) throw new Error("Only a draft can be approved.");
  await audit(userId, "campaign.approved", id, { body: c.body });
  return c;
}

/** Owner: cancel a draft or an approved campaign that hasn't been sent (nothing is deleted). */
export async function cancelCampaign(id: number, userId: number | null) {
  const [c] = await db.update(schema.smsCampaigns).set({ status: "canceled" }).where(and(eq(schema.smsCampaigns.id, id), sql`${schema.smsCampaigns.status} in ('draft','approved')`)).returning();
  if (!c) throw new Error("Only a campaign that hasn't been sent can be canceled.");
  await audit(userId, "campaign.canceled", id, {});
  return c;
}

/**
 * Send an approved campaign to every eligible customer, once each. Customers at the yearly limit, who replied STOP
 * or NO PROMO, or who never signed up are skipped. Outside 8 AM - 9 PM their text waits for the next window.
 */
export async function sendCampaign(id: number, userId: number | null, now = new Date()) {
  if (!campaignsCanSend()) throw new Error(`${CAMPAIGNS_NOT_ACTIVE}.`);
  // Claim the campaign so two clicks can't send it twice.
  const [c] = await db.update(schema.smsCampaigns).set({ status: "sent", sentBy: userId, sentAt: now }).where(and(eq(schema.smsCampaigns.id, id), eq(schema.smsCampaigns.status, "approved"))).returning();
  if (!c) throw new Error("Only an approved campaign that hasn't been sent can be sent.");
  const list = await promoSignups(now);
  const eligible = eligibleOf(list);
  let sent = 0, held = 0, skipped = 0;
  for (const s of eligible) {
    const [claim] = await db.insert(schema.smsCampaignSends).values({ campaignId: id, customerId: s.customerId, phone: s.phone, status: "pending" }).onConflictDoNothing().returning();
    if (!claim) continue; // already sent this campaign to this customer
    const r = await sendMessage({ to: s.phone, body: c.body, kind: "marketing", event: `campaign:${id}`, customerId: s.customerId, userId, now });
    const status = r.sent ? "sent" : r.held ? "held" : "skipped";
    if (status === "sent") sent++;
    else if (status === "held") held++;
    else skipped++;
    await db.update(schema.smsCampaignSends).set({ status, messageId: r.messageId ?? null, reason: status === "skipped" ? r.error ?? r.blocked ?? null : null }).where(eq(schema.smsCampaignSends.id, claim.id));
  }
  // Signed-up customers who can't get this one are recorded too, with the reason (campaign history)
  for (const s of list.filter((x) => x.status !== "Active")) {
    const [row] = await db
      .insert(schema.smsCampaignSends)
      .values({ campaignId: id, customerId: s.customerId, phone: s.phone, status: "skipped", reason: s.status === "At yearly limit" ? `Already got ${PROMOS_PER_YEAR} promo texts this year` : "Replied STOP (no texts)" })
      .onConflictDoNothing()
      .returning();
    if (row) skipped++;
  }
  const [done] = await db.update(schema.smsCampaigns).set({ eligibleCount: eligible.length, sentCount: sent, heldCount: held, skippedCount: skipped }).where(eq(schema.smsCampaigns.id, id)).returning();
  await audit(userId, "campaign.sent", id, { eligible: eligible.length, sent, held, skipped });
  return done;
}

/** What customers will actually receive (the required opening/ending added). */
export const campaignPreview = (body: string) => marketingBody(body);

export type CampaignRecipient = { customerId: number; name: string | null; phone: string; status: string; reason: string | null; delivery: string | null; at: Date };

/** Campaign history: everyone it was sent to or skipped (with why), and the delivery result from the carrier. */
export async function campaignRecipients(id: number): Promise<CampaignRecipient[]> {
  const rows = await db
    .select({ s: schema.smsCampaignSends, name: schema.customers.name, delivery: schema.messages.status, err: schema.messages.errorMessage })
    .from(schema.smsCampaignSends)
    .leftJoin(schema.customers, eq(schema.customers.id, schema.smsCampaignSends.customerId))
    .leftJoin(schema.messages, eq(schema.messages.id, schema.smsCampaignSends.messageId))
    .where(eq(schema.smsCampaignSends.campaignId, id))
    .orderBy(schema.smsCampaignSends.id);
  return rows.map((r) => ({ customerId: r.s.customerId, name: r.name, phone: r.s.phone, status: r.s.status, reason: r.s.reason ?? r.err ?? null, delivery: r.delivery, at: r.s.createdAt }));
}
