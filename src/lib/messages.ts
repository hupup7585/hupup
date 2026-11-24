import { phoneQueryDigits } from "@/lib/phone-search";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/**
 * Text conversations for /admin/messages, grouped by the customer's number (contact_phone).
 * Only selects columns that exist on the live database today.
 */
export type ThreadRow = { contact_phone: string; last_body: string; last_direction: "in" | "out"; last_at: string; unread: number; customer_id: number | null; customer_name: string | null };

/** A text that only asks for the catalog (the same rule as the CATALOG auto-reply, isCatalogText). */
const CATALOG_TEXT = sql`regexp_replace(lower(coalesce(m2.body, '')), '[^a-z]', '', 'g') IN ('catalog', 'catalogue') AND jsonb_array_length(m2.media_urls) = 0`;

/**
 * Which threads (Abraham, Nov 19, 2026): "conversations" = people who wrote anything else, or that staff texted (the
 * default); "catalog" = numbers that only texted CATALOG and got the automatic reply; "all" = both.
 */
export type ThreadView = "conversations" | "catalog" | "all";

export async function listThreads(q?: string, limit = 200, view: ThreadView = "all"): Promise<ThreadRow[]> {
  const like = q?.trim() ? `%${q.trim()}%` : null;
  const digits = phoneQueryDigits(q) ?? (q?.replace(/\D/g, "") || ""); // however it is typed (Nov 24, 2026)
  const catalogOnly = sql`(
    EXISTS (SELECT 1 FROM messages m2 WHERE m2.contact_phone = l.contact_phone AND m2.direction = 'in' AND ${CATALOG_TEXT})
    AND NOT EXISTS (SELECT 1 FROM messages m2 WHERE m2.contact_phone = l.contact_phone AND m2.direction = 'in' AND NOT (${CATALOG_TEXT}))
    AND NOT EXISTS (SELECT 1 FROM messages m2 WHERE m2.contact_phone = l.contact_phone AND m2.direction = 'out' AND coalesce(m2.event, '') <> 'catalog_reply')
  )`;
  const viewWhere = view === "catalog" ? catalogOnly : view === "conversations" ? sql`NOT ${catalogOnly}` : sql`true`;
  const r = await db.execute(sql`
    WITH last AS (
      SELECT DISTINCT ON (m.contact_phone) m.contact_phone, m.body AS last_body, m.direction AS last_direction, m.created_at AS last_at
      FROM messages m
      WHERE m.kind <> 'system' OR m.direction = 'in' OR m.event = 'catalog_reply'
      ORDER BY m.contact_phone, m.created_at DESC
    )
    SELECT l.contact_phone, l.last_body, l.last_direction, l.last_at::text,
           (SELECT COUNT(*)::int FROM messages u WHERE u.contact_phone = l.contact_phone AND u.direction = 'in' AND u.read_at IS NULL) AS unread,
           c.id AS customer_id, c.name AS customer_name
    FROM last l LEFT JOIN customers c ON c.phone = l.contact_phone
    WHERE ${viewWhere}
    ${like ? sql`AND (c.name ILIKE ${like} OR l.last_body ILIKE ${like} ${digits.length >= 3 ? sql`OR l.contact_phone LIKE ${`%${digits}%`}` : sql``})` : sql``}
    ORDER BY l.last_at DESC
    LIMIT ${limit}`);
  return r.rows as ThreadRow[];
}

/** How many threads with unread texts in each view (the tabs' counts). */
export async function threadCounts() {
  const [conv, cat] = await Promise.all([listThreads(undefined, 1000, "conversations"), listThreads(undefined, 1000, "catalog")]);
  return { conversations: conv.filter((t) => t.unread > 0).length, catalog: cat.filter((t) => t.unread > 0).length };
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
    // Catalog-only texts (CATALOG) have their own tab and are not counted here (Abraham, Nov 19, 2026)
    .where(and(eq(schema.messages.direction, "in"), isNull(schema.messages.readAt), sql`NOT (regexp_replace(lower(coalesce(${schema.messages.body}, '')), '[^a-z]', '', 'g') IN ('catalog', 'catalogue') AND jsonb_array_length(${schema.messages.mediaUrls}) = 0)`));
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
