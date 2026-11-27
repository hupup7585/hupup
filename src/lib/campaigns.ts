import { and, desc, eq, isNotNull, lt, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { promosPerYear } from "@/lib/promo-limit";
import { marketingBody, promosThisYear, sendMessage } from "@/lib/sms";
import { textingActive } from "@/lib/voicemail";
import { config } from "@/lib/config";
import { PROMO_MAX_CHARS, PROMO_MAX_PICTURES, offerWithLink, promoTextV2 } from "@/lib/promo-text";
import { pictureUrl, picturesByIds } from "@/lib/promo-pictures";

/**
 * Seasonal promo campaigns (Abraham, Nov 9, 2026).
 * - The Owner writes the wording and approves it; the Secretary can only send approved campaigns.
 * - Only customers who signed up for promos (and didn't reply STOP or NO PROMO) get them, at most 5 a year (Admin setting promosPerYear).
 * - Every text goes through sendMessage, which rechecks consent, the yearly limit and quiet hours at the moment of sending.
 */
export type Campaign = typeof schema.smsCampaigns.$inferSelect;

/** Texting can actually go out (A2P approved), or this isn't the live site. */
export const campaignsCanSend = (env: Record<string, string | undefined> = process.env) => textingActive(env) || env.VERCEL_ENV !== "production";
export const CAMPAIGNS_NOT_ACTIVE = "Not active yet: waiting for Twilio A2P approval";

export { segments } from "@/lib/promo-text";

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
    .where(and(eq(schema.customers.marketingOptIn, true), isNotNull(schema.customers.phone), eq(schema.customers.isTest, false)))
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
      status: c.smsOptOut ? "Stopped all texts" : thisYear >= (await promosPerYear()) ? "At yearly limit" : "Active",
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

/** Owner: a new campaign (draft): the offer, up to two pictures, and the optional Rentals page link. */
export async function createCampaign(input: { name: string; body: string; pictureIds?: number[]; rentalsLink?: boolean }, userId: number | null): Promise<Campaign> {
  const name = input.name.replace(/\s+/g, " ").trim().slice(0, 80);
  const body = input.body.replace(/\s+/g, " ").trim();
  const pictureIds = [...new Set((input.pictureIds ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  const rentalsLink = Boolean(input.rentalsLink);
  if (!name) throw new Error("Give the campaign a name, like 'Summer 2027'.");
  if (body.length < 10) throw new Error("Write the offer (at least a few words).");
  const full = promoTextV2(offerWithLink(body, rentalsLink, config.baseUrl()));
  if (full.length > PROMO_MAX_CHARS) throw new Error(`Too long: ${full.length} characters with the required start and ending. The most is ${PROMO_MAX_CHARS}.`);
  if (pictureIds.length > PROMO_MAX_PICTURES) throw new Error(`At most ${PROMO_MAX_PICTURES} pictures per promo text.`);
  if ((await picturesByIds(pictureIds)).length !== pictureIds.length) throw new Error("A picture is missing. Add it again.");
  const [c] = await db.insert(schema.smsCampaigns).values({ name, body, pictureIds, rentalsLink, createdBy: userId }).returning();
  await audit(userId, "campaign.created", c.id, { name, body, pictureIds, rentalsLink });
  return c;
}

/** The exact text customers get, and the picture links (MMS when there are pictures). */
export async function campaignMessage(c: Pick<Campaign, "body" | "pictureIds" | "rentalsLink">) {
  const offer = offerWithLink(c.body, c.rentalsLink, config.baseUrl());
  const pictures = await picturesByIds(c.pictureIds ?? []);
  return { offer, text: promoTextV2(offer), pictures, mediaUrls: pictures.map((p) => pictureUrl(p.token)) };
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
/** A campaign stopped partway ("sending") can be sent again after this long. */
export const CAMPAIGN_RESUME_AFTER_MS = 10 * 60_000;

export async function sendCampaign(id: number, userId: number | null, now = new Date()) {
  if (!campaignsCanSend()) throw new Error(`${CAMPAIGNS_NOT_ACTIVE}.`);
  // Extra check F6 (Nov 27, 2026): the length is checked before the campaign is claimed, and it is claimed as
  // "sending" (not "sent"), so an error partway leaves it able to finish: after 10 minutes Send works again and only
  // the customers who didn't get it yet are texted (each customer's row is claimed once).
  const [pre] = await db.select().from(schema.smsCampaigns).where(eq(schema.smsCampaigns.id, id)).limit(1);
  if (pre) {
    const m = await campaignMessage(pre);
    if (m.text.length > PROMO_MAX_CHARS) throw new Error(`Too long to send (${m.text.length} characters; the most is ${PROMO_MAX_CHARS}).`);
  }
  // Claim the campaign so two clicks can't send it twice.
  const stale = new Date(Date.now() - CAMPAIGN_RESUME_AFTER_MS);
  const [c] = await db
    .update(schema.smsCampaigns)
    .set({ status: "sending", sentBy: userId, sentAt: now })
    .where(and(eq(schema.smsCampaigns.id, id), or(eq(schema.smsCampaigns.status, "approved"), and(eq(schema.smsCampaigns.status, "sending"), lt(schema.smsCampaigns.sentAt, stale)))))
    .returning();
  if (!c) throw new Error("Only an approved campaign that hasn't been sent can be sent.");
  const msg = await campaignMessage(c);
  const list = await promoSignups(now);
  // Extra check F2 (Nov 27, 2026): one text per phone number, even when two customer records share it
  const eligible = [...new Map(eligibleOf(list).map((x) => [x.phone, x])).values()];
  const rowsBefore = await db.select().from(schema.smsCampaignSends).where(eq(schema.smsCampaignSends.campaignId, id));
  // Deep check 06:00 M69 (F6 leftover): a run cut off between claiming a customer ("pending") and sending left them out
  // for good. On a resume, a pending customer with no text for this campaign is sent it now; one whose text was saved
  // gets that text's result.
  const retry = new Map<string, (typeof rowsBefore)[number]>();
  for (const r of rowsBefore.filter((x) => x.status === "pending")) {
    const [m] = await db
      .select({ id: schema.messages.id, status: schema.messages.status, twilioSid: schema.messages.twilioSid })
      .from(schema.messages)
      .where(and(eq(schema.messages.contactPhone, r.phone), eq(schema.messages.event, `campaign:${id}`), eq(schema.messages.direction, "out")))
      .limit(1);
    if (!m) retry.set(r.phone, r);
    else {
      // "queued" with no Twilio id: saved, but never handed to Twilio before the stop (review follow-up): not "sent"
      const st = m.status === "held" ? "held" : ["blocked", "failed", "undelivered", "canceled"].includes(String(m.status)) || (m.status === "queued" && !m.twilioSid) ? "skipped" : "sent";
      await db.update(schema.smsCampaignSends).set({ status: st, messageId: m.id }).where(eq(schema.smsCampaignSends.id, r.id));
    }
  }
  const already = new Set(rowsBefore.filter((r) => !retry.has(r.phone)).map((r) => r.phone));
  let sent = 0, held = 0, skipped = 0;
  for (const s of eligible) {
    if (already.has(s.phone)) continue; // this number already got (or is getting) this campaign
    const [claim] = retry.has(s.phone)
      ? [retry.get(s.phone)!]
      : await db.insert(schema.smsCampaignSends).values({ campaignId: id, customerId: s.customerId, phone: s.phone, status: "pending" }).onConflictDoNothing().returning();
    if (!claim) continue; // already sent this campaign to this customer
    const r = await sendMessage({ to: s.phone, body: msg.offer, mediaUrls: msg.mediaUrls, kind: "marketing", event: `campaign:${id}`, customerId: s.customerId, userId, now });
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
      .values({ campaignId: id, customerId: s.customerId, phone: s.phone, status: "skipped", reason: s.status === "At yearly limit" ? `Already got ${await promosPerYear()} promo texts this year` : "Replied STOP (no texts)" })
      .onConflictDoNothing()
      .returning();
    if (row) skipped++;
  }
  // The counts come from the saved rows, so a campaign finished after a stop still shows every customer
  const rows = await db.select({ status: schema.smsCampaignSends.status }).from(schema.smsCampaignSends).where(eq(schema.smsCampaignSends.campaignId, id));
  const n = (st: string) => rows.filter((r) => r.status === st).length;
  if (rows.length) [sent, held, skipped] = [n("sent"), n("held"), n("skipped")];
  const [done] = await db.update(schema.smsCampaigns).set({ status: "sent", eligibleCount: eligible.length, sentCount: sent, heldCount: held, skippedCount: skipped }).where(eq(schema.smsCampaigns.id, id)).returning();
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
