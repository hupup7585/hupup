import { sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/**
 * Possible duplicate customers (Hark for Abraham, Nov 27, 2026, 2:14 AM ET, item 2): a READ-ONLY list of customer
 * records that are probably the same person: the same phone number, or the same name and the same address, across
 * phone, website and staff bookings. Nothing is merged by itself: a group is merged only when the Owner presses its
 * Merge button. Merging moves every order (and so its payments), text, invoice and email to the kept record (consent
 * and terms records are never changed; the kept record links to them); it never deletes an order, a payment or a customer record; a STOP on any record wins.
 */

export type DupRecord = {
  id: number;
  name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  orderAddresses: string[];
  orders: number;
  cancelled: number;
  firstOrder: string | null;
  lastOrder: string | null;
  channels: string[];
  smsOptOut: boolean;
  marketingOptIn: boolean;
  isTest: boolean;
  createdAt: string;
};

export type DupGroup = {
  /** Stable key: the record ids, lowest first */
  key: string;
  reasons: string[];
  records: DupRecord[];
  /** The record we would keep: most orders, then has a name, then the latest order, then the oldest record */
  suggestedKeepId: number;
  anyStop: boolean;
};

/** Last 10 digits of a US number, or null when it is not a full number. */
export function phoneKey(p: string | null | undefined): string | null {
  const d = (p ?? "").replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return ten.length === 10 ? ten : null;
}

/** Name in any word order and case, letters and digits only ("Schwartz, Abraham" = "abraham schwartz"). */
export function nameKey(n: string | null | undefined): string | null {
  const words = (n ?? "").toLowerCase().replace(/[^a-z0-9֐-׿\s]/g, " ").split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  return words.sort().join(" ");
}

const SUFFIX: Record<string, string> = {
  street: "st", road: "rd", lane: "ln", avenue: "ave", av: "ave", court: "ct", drive: "dr", boulevard: "blvd",
  place: "pl", terrace: "ter", circle: "cir", highway: "hwy", parkway: "pkwy", way: "way", north: "n", south: "s",
  east: "e", west: "w", apartment: "unit", apt: "unit", suite: "unit", ste: "unit",
};

/** The house and street (the part before the first comma), with common spellings made the same. */
export function addressKey(a: string | null | undefined): string | null {
  const first = (a ?? "").split(",")[0].toLowerCase().replace(/#/g, " unit ").replace(/[^a-z0-9\s]/g, " ");
  const words = first.split(/\s+/).filter(Boolean).map((w) => SUFFIX[w] ?? w);
  if (words.length < 2 || !/\d/.test(words.join(""))) return null; // needs a house number and a street
  return words.join(" ");
}

type Raw = {
  id: number; name: string | null; phone: string | null; email: string | null; address: string | null;
  sms_opt_out: boolean; marketing_opt_in: boolean; is_test: boolean; created_at: string;
  orders: number; cancelled: number; first_order: string | null; last_order: string | null;
  channels: string[] | null; order_addresses: string[] | null;
};

/** Customer ids already merged into another record (kept for the record, left off the list). */
async function mergedAwayIds(): Promise<Set<number>> {
  const rows = (await db.execute(sql`SELECT entity_id FROM audit_log WHERE action = 'customer.merged_into' AND entity_type = 'customer'`)).rows as { entity_id: string }[];
  return new Set(rows.map((r) => Number(r.entity_id)));
}

export async function findDuplicateCustomers(): Promise<DupGroup[]> {
  const raw = (
    await db.execute(sql`
      SELECT c.id, c.name, c.phone, c.email, c.address, c.sms_opt_out, c.marketing_opt_in, c.is_test, c.created_at::text AS created_at,
             COUNT(o.id)::int AS orders,
             COUNT(o.id) FILTER (WHERE o.status = 'CANCELLED')::int AS cancelled,
             MIN(o.created_at)::date::text AS first_order,
             MAX(o.created_at)::date::text AS last_order,
             array_remove(array_agg(DISTINCT CASE WHEN o.id IS NULL THEN NULL WHEN o.channel = 'POS' THEN 'Staff' WHEN o.call_sid IS NOT NULL THEN 'Phone' ELSE 'Website' END), NULL) AS channels,
             array_remove(array_agg(DISTINCT o.delivery_address), NULL) AS order_addresses
      FROM customers c
      LEFT JOIN orders o ON o.customer_id = c.id
      GROUP BY c.id
      ORDER BY c.id`)
  ).rows as Raw[];
  const merged = await mergedAwayIds();
  const recs: DupRecord[] = raw
    .filter((r) => !merged.has(Number(r.id)))
    .map((r) => ({
      id: Number(r.id), name: r.name, phone: r.phone, email: r.email, address: r.address,
      orderAddresses: r.order_addresses ?? [], orders: Number(r.orders), cancelled: Number(r.cancelled),
      firstOrder: r.first_order, lastOrder: r.last_order, channels: r.channels ?? [],
      smsOptOut: !!r.sms_opt_out, marketingOptIn: !!r.marketing_opt_in, isTest: !!r.is_test, createdAt: r.created_at,
    }));
  return groupDuplicates(recs);
}

/** Pure grouping (tested on its own): records joined by a shared phone, or a shared name and address. */
export function groupDuplicates(recs: DupRecord[]): DupGroup[] {
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(Math.max(ra, rb), Math.min(ra, rb));
  };
  for (const r of recs) parent.set(r.id, r.id);
  const reasonsByPair: { a: number; b: number; reason: string }[] = [];
  const index = (keyOf: (r: DupRecord) => string[], label: (k: string) => string) => {
    const seen = new Map<string, number>();
    for (const r of recs) {
      for (const k of new Set(keyOf(r))) {
        const first = seen.get(k);
        if (first === undefined) seen.set(k, r.id);
        else {
          union(first, r.id);
          reasonsByPair.push({ a: first, b: r.id, reason: label(k) });
        }
      }
    }
  };
  index((r) => { const k = phoneKey(r.phone); return k ? [k] : []; }, (k) => `Same phone number (${k.slice(0, 3)}) ${k.slice(3, 6)}-${k.slice(6)}`);
  index(
    (r) => {
      const n = nameKey(r.name);
      if (!n) return [];
      return [r.address, ...r.orderAddresses].map(addressKey).filter((a): a is string => !!a).map((a) => `${n}|${a}`);
    },
    (k) => "Same name and address",
  );
  const groups = new Map<number, DupRecord[]>();
  for (const r of recs) {
    const root = find(r.id);
    const g = groups.get(root);
    if (g) g.push(r);
    else groups.set(root, [r]);
  }
  const out: DupGroup[] = [];
  for (const [root, records] of groups) {
    if (records.length < 2) continue;
    const reasons = [...new Set(reasonsByPair.filter((p) => find(p.a) === root).map((p) => p.reason))];
    out.push({ key: records.map((r) => r.id).sort((a, b) => a - b).join("-"), reasons, records, suggestedKeepId: suggestKeep(records), anyStop: records.some((r) => r.smsOptOut) });
  }
  // Groups with the most orders first, so the ones that matter are on top
  return out.sort((a, b) => b.records.reduce((s, r) => s + r.orders, 0) - a.records.reduce((s, r) => s + r.orders, 0) || a.records[0].id - b.records[0].id);
}

export function suggestKeep(records: DupRecord[]): number {
  const live = records.filter((r) => !r.isTest);
  const pool = live.length ? live : records;
  return [...pool].sort(
    (a, b) =>
      b.orders - b.cancelled - (a.orders - a.cancelled) ||
      Number(!!b.name?.trim()) - Number(!!a.name?.trim()) ||
      (b.lastOrder ?? "").localeCompare(a.lastOrder ?? "") ||
      a.id - b.id,
  )[0].id;
}

/**
 * Tables whose rows belong to a customer record; merging moves them all to the kept record. The consent and terms
 * records (sms_consents, terms_acceptances, sms_reenroll_requests) are legal records that can never be changed: they
 * stay exactly as written, are found by their phone number as before, and the kept record's page links to the merged
 * records that hold them.
 */
const CUSTOMER_TABLES = [
  "orders",
  "messages",
  "book_invoices",
  "sms_campaign_sends",
  "inbox_emails",
  "spoken_answers",
  "message_files",
] as const;

export type MergeResult = { ok: boolean; message: string; moved?: Record<string, number> };

/**
 * Owner only, and only when the Owner presses Merge on a group. Moves every row to the kept record, fills the kept
 * record's empty name, email and address from the others, joins the notes, and applies a STOP from any record. The
 * other records are never deleted: they keep their name and history, their phone and email move to the notes (so a
 * new call or text finds the kept record), and an audit row marks each one as merged.
 */
export async function mergeCustomers(keepId: number, otherIds: number[], userId: number | null): Promise<MergeResult> {
  const others = [...new Set(otherIds.filter((x) => Number.isInteger(x) && x > 0 && x !== keepId))];
  if (!Number.isInteger(keepId) || keepId <= 0 || !others.length) return { ok: false, message: "Choose the record to keep and at least one other record." };
  return db.transaction(async (tx) => {
    const ids = [keepId, ...others];
    const rows = (await tx.execute(sql`SELECT * FROM customers WHERE id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}) ORDER BY id FOR UPDATE`)).rows as {
      id: number; name: string | null; phone: string | null; email: string | null; address: string | null; notes: string | null;
      sms_opt_out: boolean; marketing_opt_in: boolean; marketing_opt_in_at: string | null; time_zone: string | null;
    }[];
    const keep = rows.find((r) => Number(r.id) === keepId);
    if (!keep || rows.length !== ids.length) return { ok: false, message: "One of these records no longer exists. Reload the page." };
    const done = (await tx.execute(sql`SELECT entity_id FROM audit_log WHERE action = 'customer.merged_into' AND entity_type = 'customer' AND entity_id IN (${sql.join(ids.map((i) => sql`${String(i)}`), sql`, `)})`)).rows;
    if (done.length) return { ok: false, message: "One of these records was already merged. Reload the page." };
    const rest = rows.filter((r) => Number(r.id) !== keepId);
    const moved: Record<string, number> = {};
    const otherList = sql.join(others.map((i) => sql`${i}`), sql`, `);
    for (const t of CUSTOMER_TABLES) {
      // Extra check F1 (Nov 27, 2026): a campaign row is one per campaign and customer. When both records got the same
      // campaign, the kept record's row stays and the other one stays on its merged record (nothing deleted), so the
      // merge no longer stops with an error.
      const r =
        t === "sms_campaign_sends"
          ? await tx.execute(sql`UPDATE sms_campaign_sends SET customer_id = ${keepId} WHERE id IN (
              SELECT DISTINCT ON (campaign_id) id FROM sms_campaign_sends
              WHERE customer_id IN (${otherList}) AND campaign_id NOT IN (SELECT campaign_id FROM sms_campaign_sends WHERE customer_id = ${keepId})
              ORDER BY campaign_id, id)`)
          : await tx.execute(sql`UPDATE ${sql.identifier(t)} SET customer_id = ${keepId} WHERE customer_id IN (${otherList})`);
      moved[t] = Number((r as { rowCount?: number; affectedRows?: number }).rowCount ?? (r as { affectedRows?: number }).affectedRows ?? 0);
    }
    const anyStop = rows.some((r) => r.sms_opt_out);
    const pick = (f: "name" | "email" | "address") => keep[f]?.trim() || rest.map((r) => r[f]?.trim()).find(Boolean) || null;
    const { todayISO } = await import("@/lib/dates");
    const today = todayISO(); // New York date (deep check 0600 M36)
    // Deep check 0600 M22 (Nov 27, 2026): a promo sign-up on a merged-in record was dropped. A sign-up belongs to its
    // phone number, so it is kept when that record has the same number as the kept record (with its sign-up time); a
    // sign-up on a different number is not moved to the kept number (its consent record stays with that number).
    const finalPhone = keep.phone || rest.map((r) => r.phone).find(Boolean) || null;
    const sameNumberOptIn = anyStop || keep.marketing_opt_in ? null : rest.find((r) => r.marketing_opt_in && phoneKey(r.phone) !== null && phoneKey(r.phone) === phoneKey(finalPhone));
    const otherNumberOptIns = anyStop ? [] : rest.filter((r) => r.marketing_opt_in && phoneKey(r.phone) !== phoneKey(finalPhone));
    const noteLines = [keep.notes?.trim(), ...rest.map((r) => `Merged in on ${today}: customer number ${r.id}${r.name ? ` (${r.name})` : ""}${r.phone ? `, phone ${r.phone}` : ""}${r.email ? `, email ${r.email}` : ""}${r.notes?.trim() ? `. Notes: ${r.notes.trim()}` : ""}`)].filter(Boolean);
    await tx
      .update(schema.customers)
      .set({
        name: pick("name"),
        email: pick("email"),
        address: pick("address"),
        phone: keep.phone || rest.map((r) => r.phone).find(Boolean) || null,
        notes: noteLines.join("\n"),
        // A STOP on any record wins (Abraham): no texts, and no promo opt-in
        smsOptOut: anyStop,
        ...(anyStop ? { marketingOptIn: false } : {}),
        ...(sameNumberOptIn ? { marketingOptIn: true, marketingOptInAt: sameNumberOptIn.marketing_opt_in_at ? new Date(sameNumberOptIn.marketing_opt_in_at) : new Date() } : {}),
        timeZone: keep.time_zone || (rest.map((r) => r.time_zone).find(Boolean) ?? null),
      })
      .where(sql`${schema.customers.id} = ${keepId}`);
    for (const r of rest) {
      await tx
        .update(schema.customers)
        .set({
          phone: null,
          email: null,
          // Keeps its own STOP; a STOP elsewhere also applies here
          smsOptOut: anyStop || r.sms_opt_out,
          marketingOptIn: false,
          notes: [r.notes?.trim(), `Merged into customer number ${keepId} on ${today}${r.phone ? ` (phone was ${r.phone})` : ""}${r.email ? ` (email was ${r.email})` : ""}.`].filter(Boolean).join("\n"),
        })
        .where(sql`${schema.customers.id} = ${Number(r.id)}`);
      await tx.insert(schema.auditLog).values({ userId, action: "customer.merged_into", entityType: "customer", entityId: String(r.id), before: r, after: { keptId: keepId } });
    }
    await tx.insert(schema.auditLog).values({ userId, action: "customer.merge", entityType: "customer", entityId: String(keepId), before: keep, after: { mergedIds: others, moved, stopApplied: anyStop } });
    const n = Object.values(moved).reduce((s, x) => s + x, 0);
    return { ok: true, message: `Merged ${others.length} record${others.length === 1 ? "" : "s"} into customer number ${keepId}: ${moved.orders ?? 0} order${moved.orders === 1 ? "" : "s"} and ${n - (moved.orders ?? 0)} other rows moved. Nothing was deleted.${anyStop ? " A STOP was on one of the records, so the kept record is marked Replied STOP." : ""}${sameNumberOptIn ? " The promo sign-up was kept." : ""}${otherNumberOptIns.length ? ` A promo sign-up on another number (${otherNumberOptIns.map((r) => r.phone).join(", ")}) was not moved to the kept number.` : ""}`, moved };
  });
}

/** For a customer page: records merged into this one, and the record this one was merged into. */
export async function mergeLinks(customerId: number): Promise<{ mergedIn: number[]; mergedInto: number | null }> {
  const rows = (await db.execute(sql`SELECT entity_id, after FROM audit_log WHERE action = 'customer.merged_into' AND entity_type = 'customer' AND (entity_id = ${String(customerId)} OR (after->>'keptId')::int = ${customerId}) ORDER BY id`)).rows as { entity_id: string; after: { keptId?: number } | string }[];
  const kept = (a: { keptId?: number } | string) => Number((typeof a === "string" ? JSON.parse(a) : a)?.keptId);
  return {
    mergedIn: rows.filter((r) => Number(r.entity_id) !== customerId && kept(r.after) === customerId).map((r) => Number(r.entity_id)),
    mergedInto: rows.filter((r) => Number(r.entity_id) === customerId).map((r) => kept(r.after))[0] ?? null,
  };
}
