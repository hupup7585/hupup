import { and, asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/**
 * Text-message consent for one customer, in plain words (Abraham, Nov 9, 2026): order texts and promo texts kept
 * separate, with date and time, how, confirmation status, the last opt-out and whether the number is blocked.
 * Read-only: built from the permanent consent records (sms_consents is append-only).
 */
export type Consent = typeof schema.smsConsents.$inferSelect;
export type ProgramStatus = {
  status: "Yes" | "No" | "Waiting for the customer's confirmation" | "Stopped (replied STOP)" | "Never asked";
  since: Date | null;
  source: string | null;
  method: string | null;
  lastOptOut: { at: Date; how: string } | null;
};

export const SOURCE_LABEL: Record<string, string> = {
  web: "Website",
  phone: "Phone line",
  keyword: "Text keyword",
  sms_reply: "Text reply",
  pos: "Staff (New booking)",
  staff: "Staff",
  pay_page: "Pay page",
};

const how = (c: Consent) => (c.keyword ? `texted ${c.keyword}` : SOURCE_LABEL[c.source] ?? c.source);

function program(rows: Consent[], scope: "transactional" | "marketing", smsOptOut: boolean, pending: boolean): ProgramStatus {
  const mine = rows.filter((r) => r.scope === scope && !r.correctsConsentId);
  const last = mine.at(-1);
  const lastOut = [...mine].reverse().find((r) => r.action === "opt_out");
  const lastOptOut = lastOut ? { at: lastOut.createdAt, how: how(lastOut) } : null;
  if (smsOptOut) return { status: "Stopped (replied STOP)", since: lastOut?.createdAt ?? null, source: lastOut ? how(lastOut) : null, method: null, lastOptOut };
  if (pending && last?.action !== "opt_in") return { status: "Waiting for the customer's confirmation", since: null, source: null, method: null, lastOptOut };
  if (!last) return { status: "Never asked", since: null, source: null, method: null, lastOptOut };
  return { status: last.action === "opt_in" ? "Yes" : "No", since: last.createdAt, source: SOURCE_LABEL[last.source] ?? last.source, method: last.method, lastOptOut };
}

export async function customerConsent(c: { id: number; phone: string | null; smsOptOut: boolean }) {
  const rows = c.phone
    ? await db.select().from(schema.smsConsents).where(eq(schema.smsConsents.phone, c.phone)).orderBy(asc(schema.smsConsents.createdAt), asc(schema.smsConsents.id))
    : [];
  const pend = c.phone
    ? await db
        .select({ scope: schema.smsReenrollRequests.scope })
        .from(schema.smsReenrollRequests)
        .where(and(eq(schema.smsReenrollRequests.phone, c.phone), eq(schema.smsReenrollRequests.status, "pending")))
    : [];
  return {
    order: program(rows, "transactional", c.smsOptOut, pend.some((p) => p.scope === "transactional")),
    promo: program(rows, "marketing", c.smsOptOut, pend.some((p) => p.scope === "marketing")),
    blocked: c.smsOptOut,
    history: [...rows].reverse(),
  };
}

/** Who sent each outgoing text (staff name, or "System"). */
export async function senderNames(userIds: (number | null)[]): Promise<Map<number, string>> {
  const ids = [...new Set(userIds.filter((x): x is number => x !== null))];
  if (!ids.length) return new Map();
  const rows = await db.select({ id: schema.adminUsers.id, name: schema.adminUsers.name }).from(schema.adminUsers).where(inArray(schema.adminUsers.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}
