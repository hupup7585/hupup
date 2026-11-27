import { phoneQueryDigits } from "@/lib/phone-search";
import { phoneMatchSql, phoneRankSql } from "@/lib/phone-search-sql";
import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/**
 * Search everything from the dashboard (Abraham, Nov 15, 2026; plan step 8): orders, customers, emails (Owner only),
 * voicemails and calls. Type a name, phone number, email, address or order number.
 */
export async function searchEverything(raw: string, opts: { owner: boolean }) {
  const q = raw.trim().slice(0, 100);
  if (q.length < 2) return { q, orders: [], customers: [], emails: [], voicemails: [], calls: [] };
  const like = `%${q}%`;
  const pd = phoneQueryDigits(q); // a phone number however it is typed (Nov 24, 2026)
  // Nov 25, 2026: the start of the number, the start of the local part, or the last 4; never the middle; best first
  const digits = pd && pd.length >= 3 ? pd : "";
  const phoneLike = digits ? true : null;
  const orderNo = /^#?\d{1,7}$/.test(q) ? Number(q.replace("#", "")) : null;
  const orderId = orderNo && orderNo > 1000 ? orderNo - 1000 : orderNo; // order numbers are 1000 + id

  const c = schema.customers;
  const o = schema.orders;
  const [customers, orders, emails, voicemails, calls] = await Promise.all([
    db
      .select()
      .from(c)
      .where(or(ilike(c.name, like), ilike(c.email, like), ilike(c.address, like), digits ? phoneMatchSql(c.phone, digits) : undefined, digits ? sql`EXISTS (SELECT 1 FROM orders ox WHERE ox.customer_id = ${c.id} AND ${phoneMatchSql(sql`ox.text_phone`, digits)})` : undefined))
      .orderBy(...(digits ? [phoneRankSql(c.phone, digits)] : []), desc(c.createdAt))
      .limit(10),
    db
      .select({ order: o, name: c.name, phone: c.phone })
      .from(o)
      .leftJoin(c, eq(c.id, o.customerId))
      .where(
        or(
          orderId ? eq(o.id, orderId) : undefined,
          ilike(o.deliveryAddress, like),
          ilike(c.name, like),
          digits ? phoneMatchSql(c.phone, digits) : undefined,
          digits ? phoneMatchSql(o.textPhone, digits) : undefined,
        ),
      )
      .orderBy(...(digits ? [phoneRankSql(sql`coalesce(${o.textPhone}, ${c.phone})`, digits)] : []), desc(o.eventDate))
      .limit(15),
    opts.owner
      ? db
          .select()
          .from(schema.inboxEmails)
          .where(and(isNull(schema.inboxEmails.trashedAt), or(ilike(schema.inboxEmails.fromAddress, like), ilike(schema.inboxEmails.fromName, like), ilike(schema.inboxEmails.subject, like), ilike(schema.inboxEmails.textBody, like))))
          .orderBy(desc(schema.inboxEmails.receivedAt))
          .limit(10)
      : Promise.resolve([]),
    phoneLike || q.length >= 3
      ? db
          .select()
          .from(schema.voicemails)
          // Extra check N8: only messages the Voicemail page shows (not replaced or unfinished recordings)
          .where(and(isNull(schema.voicemails.deletedAt), eq(schema.voicemails.state, "submitted"), or(digits ? phoneMatchSql(schema.voicemails.fromNumber, digits) : undefined, ilike(schema.voicemails.transcription, like))))
          .orderBy(desc(schema.voicemails.createdAt))
          .limit(10)
      : Promise.resolve([]),
    phoneLike
      ? db.select().from(schema.callSessions).where(phoneMatchSql(schema.callSessions.fromNumber, digits)).orderBy(phoneRankSql(schema.callSessions.fromNumber, digits), desc(schema.callSessions.startedAt)).limit(10)
      : Promise.resolve([]),
  ]);
  return { q, orders, customers, emails, voicemails, calls };
}

export const searchHits = (r: Awaited<ReturnType<typeof searchEverything>>) => r.orders.length + r.customers.length + r.emails.length + r.voicemails.length + r.calls.length;
