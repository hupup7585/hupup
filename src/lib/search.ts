import { and, desc, eq, ilike, isNull, or } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/**
 * Search everything from the dashboard (Abraham, Nov 15, 2026; plan step 8): orders, customers, emails (Owner only),
 * voicemails and calls. Type a name, phone number, email, address or order number.
 */
export async function searchEverything(raw: string, opts: { owner: boolean }) {
  const q = raw.trim().slice(0, 100);
  if (q.length < 2) return { q, orders: [], customers: [], emails: [], voicemails: [], calls: [] };
  const like = `%${q}%`;
  const digits = q.replace(/\D/g, "");
  const phoneLike = digits.length >= 3 ? `%${digits.slice(-10)}%` : null;
  const orderNo = /^#?\d{1,7}$/.test(q) ? Number(q.replace("#", "")) : null;
  const orderId = orderNo && orderNo > 1000 ? orderNo - 1000 : orderNo; // order numbers are 1000 + id

  const c = schema.customers;
  const o = schema.orders;
  const [customers, orders, emails, voicemails, calls] = await Promise.all([
    db
      .select()
      .from(c)
      .where(or(ilike(c.name, like), ilike(c.email, like), ilike(c.address, like), phoneLike ? ilike(c.phone, phoneLike) : undefined))
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
          phoneLike ? ilike(c.phone, phoneLike) : undefined,
        ),
      )
      .orderBy(desc(o.eventDate))
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
          .where(and(isNull(schema.voicemails.deletedAt), or(phoneLike ? ilike(schema.voicemails.fromNumber, phoneLike) : undefined, ilike(schema.voicemails.transcription, like))))
          .orderBy(desc(schema.voicemails.createdAt))
          .limit(10)
      : Promise.resolve([]),
    phoneLike
      ? db.select().from(schema.callSessions).where(ilike(schema.callSessions.fromNumber, phoneLike)).orderBy(desc(schema.callSessions.startedAt)).limit(10)
      : Promise.resolve([]),
  ]);
  return { q, orders, customers, emails, voicemails, calls };
}

export const searchHits = (r: Awaited<ReturnType<typeof searchEverything>>) => r.orders.length + r.customers.length + r.emails.length + r.voicemails.length + r.calls.length;
