import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/**
 * Text conversations for /admin/messages, grouped by the customer's number (contact_phone).
 * Only selects columns that exist on the live database today.
 */
export type ThreadRow = { contact_phone: string; last_body: string; last_direction: "in" | "out"; last_at: string; unread: number; customer_id: number | null; customer_name: string | null };

export async function listThreads(q?: string, limit = 200): Promise<ThreadRow[]> {
  const like = q?.trim() ? `%${q.trim()}%` : null;
  const digits = q?.replace(/\D/g, "") || "";
  const r = await db.execute(sql`
    WITH last AS (
      SELECT DISTINCT ON (m.contact_phone) m.contact_phone, m.body AS last_body, m.direction AS last_direction, m.created_at AS last_at
      FROM messages m
      WHERE m.kind <> 'system' OR m.direction = 'in'
      ORDER BY m.contact_phone, m.created_at DESC
    )
    SELECT l.contact_phone, l.last_body, l.last_direction, l.last_at::text,
           (SELECT COUNT(*)::int FROM messages u WHERE u.contact_phone = l.contact_phone AND u.direction = 'in' AND u.read_at IS NULL) AS unread,
           c.id AS customer_id, c.name AS customer_name
    FROM last l LEFT JOIN customers c ON c.phone = l.contact_phone
    ${like ? sql`WHERE c.name ILIKE ${like} OR l.last_body ILIKE ${like} ${digits.length >= 3 ? sql`OR l.contact_phone LIKE ${`%${digits}%`}` : sql``}` : sql``}
    ORDER BY l.last_at DESC
    LIMIT ${limit}`);
  return r.rows as ThreadRow[];
}

export async function threadMessages(phone: string) {
  return db
    .select({
      id: schema.messages.id,
      direction: schema.messages.direction,
      body: schema.messages.body,
      mediaUrls: schema.messages.mediaUrls,
      kind: schema.messages.kind,
      event: schema.messages.event,
      status: schema.messages.status,
      errorMessage: schema.messages.errorMessage,
      userId: schema.messages.userId,
      orderId: schema.messages.orderId,
      createdAt: schema.messages.createdAt,
    })
    .from(schema.messages)
    .where(eq(schema.messages.contactPhone, phone))
    .orderBy(asc(schema.messages.createdAt))
    .limit(500);
}

export async function markThreadRead(phone: string) {
  await db
    .update(schema.messages)
    .set({ readAt: new Date() })
    .where(and(eq(schema.messages.contactPhone, phone), eq(schema.messages.direction, "in"), isNull(schema.messages.readAt)));
}

export async function unreadTexts() {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.messages)
    .where(and(eq(schema.messages.direction, "in"), isNull(schema.messages.readAt)));
  return r?.n ?? 0;
}

/** Customer columns that exist on the live database (time zone columns arrive with a pending migration). */
export const CUSTOMER_COLS = {
  id: schema.customers.id,
  name: schema.customers.name,
  phone: schema.customers.phone,
  email: schema.customers.email,
  address: schema.customers.address,
  notes: schema.customers.notes,
  smsOptOut: schema.customers.smsOptOut,
  marketingOptIn: schema.customers.marketingOptIn,
  isTest: schema.customers.isTest,
  createdAt: schema.customers.createdAt,
};
