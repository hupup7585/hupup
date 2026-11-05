import { and, asc, desc, eq, gt, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { config } from "@/lib/config";
import { inRecipientPromoHours } from "@/lib/area-code-tz";
import { PROMO_OPENING } from "@/lib/sms-consent-copy";
import { sendEmail } from "@/lib/notify";
import { sendMessage } from "@/lib/sms";

/**
 * SMS compliance monitoring (policy section 12). Automatic checks over consent records, opt-outs and
 * promotional message history, plus employee access, for the Owner's periodic review. Suspected failures
 * can be reported by any staff member and reach the Owner immediately.
 */

export const REVIEW_INTERVAL_DAYS = 30;

/** Messages that actually went (or were handed to Twilio), as opposed to blocked/canceled/failed. */
const SENT_STATUSES = new Set(["queued", "accepted", "scheduled", "sending", "sent", "delivered", "dev", "read"]);

export type Finding = { check: string; messageId?: number; consentId?: number; phone: string; at: Date; detail: string };

type Msg = { id: number; contactPhone: string | null; body: string; kind: string; event: string | null; status: string; customerId: number | null; createdAt: Date };
type Consent = { id: number; phone: string; scope: string; action: string; source: string; disclosureRead: boolean | null; correctsConsentId: number | null; createdAt: Date };
type Cust = { id: number; timeZone: string | null };

/** Pure checks (no database): run over already-loaded rows. Exported for tests. */
export function findComplianceIssues(input: { messages: Msg[]; consents: Consent[]; customers: Cust[] }): Finding[] {
  const out: Finding[] = [];
  const byPhone = new Map<string, Consent[]>();
  for (const c of [...input.consents].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id)) {
    byPhone.set(c.phone, [...(byPhone.get(c.phone) ?? []), c]);
  }
  const tz = new Map(input.customers.map((c) => [c.id, c.timeZone]));
  const latestBefore = (phone: string, scope: string, at: Date) => {
    const list = (byPhone.get(phone) ?? []).filter((c) => c.scope === scope && c.createdAt <= at);
    return list.at(-1) ?? null;
  };

  for (const m of input.messages) {
    if (!m.contactPhone || !SENT_STATUSES.has(m.status) || m.kind === "inbound") continue;
    const phone = m.contactPhone;
    if (m.kind === "marketing") {
      const c = latestBefore(phone, "marketing", m.createdAt);
      if (c?.action !== "opt_in") out.push({ check: "promo_without_consent", messageId: m.id, phone, at: m.createdAt, detail: "Promotional text sent without a promotional opt-in on record at that time." });
      if (!inRecipientPromoHours(phone, m.createdAt, m.customerId ? tz.get(m.customerId) : null))
        out.push({ check: "promo_quiet_hours", messageId: m.id, phone, at: m.createdAt, detail: "Promotional text sent outside 8 AM - 9 PM for the recipient." });
      if (!m.body.startsWith(PROMO_OPENING)) out.push({ check: "promo_missing_opening", messageId: m.id, phone, at: m.createdAt, detail: `Promotional text doesn't begin with "${PROMO_OPENING}".` });
    }
    // After a STOP (transactional opt-out), only the opt-out confirmation may go out until a new opt-in.
    const t = latestBefore(phone, "transactional", m.createdAt);
    if (t?.action === "opt_out" && t.source === "keyword" && m.event !== "opt_out_confirmation" && m.event !== "reenroll_request")
      out.push({ check: "sent_after_opt_out", messageId: m.id, phone, at: m.createdAt, detail: "Text sent after the customer opted out (STOP) and before any new consent." });
  }

  for (const c of input.consents) {
    if ((c.source === "staff" || c.source === "pos") && c.action === "opt_in" && !c.correctsConsentId && !c.disclosureRead)
      out.push({ check: "staff_optin_without_disclosure", consentId: c.id, phone: c.phone, at: c.createdAt, detail: "Staff recorded an opt-in without confirming the full disclosure was read." });
  }
  return out.sort((a, b) => b.at.getTime() - a.at.getTime());
}

export const CHECK_LABELS: Record<string, string> = {
  promo_without_consent: "Promotional text without consent",
  promo_quiet_hours: "Promotional text outside quiet hours",
  promo_missing_opening: "Promotional text missing the required opening",
  sent_after_opt_out: "Text sent after an opt-out",
  staff_optin_without_disclosure: "Staff opt-in without full disclosure",
};

/** Owner check: the Owner account (or the original owner login, which has no user id). */
export async function isOwnerSession(userId: number | null | undefined): Promise<boolean> {
  if (!userId) return true;
  const [u] = await db.select({ role: schema.adminUsers.role, active: schema.adminUsers.active }).from(schema.adminUsers).where(eq(schema.adminUsers.id, userId)).limit(1);
  return Boolean(u?.active && u.role === "owner");
}

/** Everything the Owner reviews, for the last `days` days. */
export async function complianceSnapshot(days = REVIEW_INTERVAL_DAYS) {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);
  const messages = await db
    .select({ id: schema.messages.id, contactPhone: schema.messages.contactPhone, body: schema.messages.body, kind: schema.messages.kind, event: schema.messages.event, status: schema.messages.status, customerId: schema.messages.customerId, createdAt: schema.messages.createdAt, errorMessage: schema.messages.errorMessage })
    .from(schema.messages)
    .where(and(eq(schema.messages.direction, "out"), gt(schema.messages.createdAt, since)))
    .orderBy(desc(schema.messages.createdAt));
  const phones = [...new Set(messages.map((m) => m.contactPhone).filter((p): p is string => Boolean(p)))];
  const periodConsents = await db.select().from(schema.smsConsents).where(gt(schema.smsConsents.createdAt, since)).orderBy(desc(schema.smsConsents.createdAt));
  // Full history for the phones messaged in the period, so "consent at the time" is judged correctly.
  const historyConsents = phones.length ? await db.select().from(schema.smsConsents).where(inArray(schema.smsConsents.phone, phones)).orderBy(asc(schema.smsConsents.createdAt)) : [];
  const custIds = [...new Set(messages.map((m) => m.customerId).filter((x): x is number => Boolean(x)))];
  const customers = custIds.length ? await db.select({ id: schema.customers.id, timeZone: schema.customers.timeZone }).from(schema.customers).where(inArray(schema.customers.id, custIds)) : [];
  const allConsents = new Map([...historyConsents, ...periodConsents].map((c) => [c.id, c]));
  const findings = findComplianceIssues({ messages, consents: [...allConsents.values()], customers });

  const promos = messages.filter((m) => m.kind === "marketing");
  const promoByStatus = promos.reduce<Record<string, number>>((acc, m) => ((acc[m.status] = (acc[m.status] ?? 0) + 1), acc), {});
  const consentCounts = periodConsents.reduce<Record<string, number>>((acc, c) => {
    const k = `${c.scope}:${c.action}`;
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
  const optOuts = periodConsents.filter((c) => c.action === "opt_out");
  const staffEntries = periodConsents.filter((c) => c.source === "staff" || c.correctsConsentId);

  const users = await db.select({ id: schema.adminUsers.id, name: schema.adminUsers.name, role: schema.adminUsers.role, active: schema.adminUsers.active }).from(schema.adminUsers).orderBy(asc(schema.adminUsers.name));
  const sessions = await db.select({ userId: schema.adminSessions.userId, createdAt: schema.adminSessions.createdAt }).from(schema.adminSessions).where(gt(schema.adminSessions.expiresAt, new Date()));
  const lastSignIn = new Map<number | null, Date>();
  for (const s of sessions) if (!lastSignIn.get(s.userId) || lastSignIn.get(s.userId)! < s.createdAt) lastSignIn.set(s.userId, s.createdAt);

  const reviews = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "compliance.review_completed")).orderBy(desc(schema.auditLog.createdAt)).limit(5);
  const issues = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "compliance.issue_reported")).orderBy(desc(schema.auditLog.createdAt)).limit(20);
  const lastReview = reviews[0]?.createdAt ?? null;
  const reviewOverdue = !lastReview || Date.now() - lastReview.getTime() > REVIEW_INTERVAL_DAYS * 24 * 3600 * 1000;

  return {
    days,
    findings,
    promoTotal: promos.length,
    promoByStatus,
    consentCounts,
    optOuts,
    staffEntries,
    users: users.map((u) => ({ ...u, activeSessions: sessions.filter((s) => s.userId === u.id).length, lastSignIn: lastSignIn.get(u.id) ?? null })),
    ownerLoginSessions: sessions.filter((s) => s.userId === null).length,
    reviews,
    issues,
    lastReview,
    reviewOverdue,
  };
}

/** Any staff member can report a suspected compliance failure; the Owner is notified immediately. */
export async function reportComplianceIssue(input: { userId: number | null; description: string; ip?: string | null; userAgent?: string | null }) {
  const description = input.description.trim().slice(0, 2000);
  if (!description) throw new Error("Please describe what happened.");
  await db.insert(schema.auditLog).values({ userId: input.userId, action: "compliance.issue_reported", entityType: "compliance", after: { description }, ip: input.ip ?? null, userAgent: input.userAgent ?? null });
  const note = `Hup Up Attractions compliance alert: a staff member reported a possible SMS compliance problem. Review it in the admin under Compliance. Report: ${description.slice(0, 300)}`;
  const phone = config.adminPhone();
  const email = config.adminEmail();
  if (phone) await sendMessage({ to: phone, body: note, kind: "system", event: "compliance_alert" });
  if (email) await sendEmail(email, "SMS compliance issue reported", `${note}\n\nFull report:\n${description}`);
}

/** The Owner records that a periodic review was done (who, when, notes, and what the checks showed). */
export async function recordComplianceReview(input: { userId: number | null; notes: string; findings: number; ip?: string | null; userAgent?: string | null }) {
  await db.insert(schema.auditLog).values({ userId: input.userId, action: "compliance.review_completed", entityType: "compliance", after: { notes: input.notes.trim().slice(0, 2000), findingsAtReview: input.findings }, ip: input.ip ?? null, userAgent: input.userAgent ?? null });
}
