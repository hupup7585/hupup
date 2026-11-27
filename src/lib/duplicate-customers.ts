import { eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/*
 * Possible duplicate customers (Abraham, Nov 27, 2026, 2:14 AM): a READ-ONLY list of customer records that are likely
 * the same person (the same phone number, or the same name and address), from phone, website and staff bookings.
 * Nothing is merged until the Owner presses Merge on a group. Merging moves orders (and with them their payments),
 * texts, invoices, emails and files to the kept record, adds the notes, and never deletes anything. Consent records
 * cannot be changed (they are append-only), so they stay as they are and still apply by phone number; a STOP on any
 * record wins (the kept record is stopped too).
 */

export type DupRecord = {
  id: number;
  name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  orders: number;
  firstOrder: string | null;
  lastOrder: string | null;
  smsOptOut: boolean;
  marketingOptIn: boolean;
  createdAt: Date;
};
export type DupGroup = { key: string; why: string[]; records: DupRecord[]; keepId: number };

const digits10 = (p: string | null) => (p ?? "").replace(/\D/g, "").slice(-10);
const normName = (n: string | null) => (n ?? "").toLowerCase().replace(/[^a-z֐-׿]+/g, " ").trim().split(" ").filter(Boolean).sort().join(" ");
const normAddr = (a: string | null) =>
  (a ?? "")
    .toLowerCase()
    .replace(/\b(street)\b/g, "st")
    .replace(/\b(road)\b/g, "rd")
    .replace(/\b(avenue)\b/g, "ave")
    .replace(/\b(drive)\b/g, "dr")
    .replace(/\b(lane)\b/g, "ln")
    .replace(/\b(court)\b/g, "ct")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Which record to keep: the most orders, then the latest order, then the oldest record. */
export function suggestKeep(rs: DupRecord[]): number {
  return [...rs].sort((a, b) => b.orders - a.orders || (b.lastOrder ?? "").localeCompare(a.lastOrder ?? "") || a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id)[0].id;
}

export async function findDuplicateCustomers(): Promise<DupGroup[]> {
  const cs = await db.select().from(schema.customers).where(isNull(schema.customers.mergedIntoId));
  const os = await db.select({ customerId: schema.orders.customerId, eventDate: schema.orders.eventDate }).from(schema.orders);
  const stats = new Map<number, { n: number; first: string | null; last: string | null }>();
  for (const o of os) {
    if (!o.customerId) continue;
    const s = stats.get(o.customerId) ?? { n: 0, first: null, last: null };
    s.n++;
    if (!s.first || o.eventDate < s.first) s.first = o.eventDate;
    if (!s.last || o.eventDate > s.last) s.last = o.eventDate;
    stats.set(o.customerId, s);
  }
  // union-find over "same phone" and "same name + address"
  const parent = new Map<number, number>(cs.map((c) => [c.id, c.id]));
  const find = (x: number): number => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x)!)), parent.get(x)!));
  const why = new Map<string, Set<string>>();
  const link = (ids: number[], reason: string) => {
    for (const id of ids.slice(1)) parent.set(find(id), find(ids[0]));
    for (const id of ids) {
      const k = String(id);
      why.set(k, (why.get(k) ?? new Set()).add(reason));
    }
  };
  const byKey = (f: (c: (typeof cs)[number]) => string) => {
    const m = new Map<string, number[]>();
    for (const c of cs) {
      const k = f(c);
      if (k) m.set(k, [...(m.get(k) ?? []), c.id]);
    }
    return [...m.values()].filter((v) => v.length > 1);
  };
  for (const ids of byKey((c) => (digits10(c.phone).length === 10 ? digits10(c.phone) : ""))) link(ids, "same phone number");
  for (const ids of byKey((c) => (normName(c.name) && normAddr(c.address) ? `${normName(c.name)}|${normAddr(c.address)}` : ""))) link(ids, "same name and address");
  const groups = new Map<number, number[]>();
  for (const c of cs) {
    const r = find(c.id);
    groups.set(r, [...(groups.get(r) ?? []), c.id]);
  }
  const out: DupGroup[] = [];
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    const records = ids.map((id) => {
      const c = cs.find((x) => x.id === id)!;
      const s = stats.get(id);
      return { id, name: c.name, phone: c.phone, email: c.email, address: c.address, orders: s?.n ?? 0, firstOrder: s?.first ?? null, lastOrder: s?.last ?? null, smsOptOut: c.smsOptOut, marketingOptIn: c.marketingOptIn, createdAt: c.createdAt };
    });
    const reasons = new Set<string>();
    for (const id of ids) for (const r of why.get(String(id)) ?? []) reasons.add(r);
    out.push({ key: ids.slice().sort((a, b) => a - b).join("-"), why: [...reasons], records, keepId: suggestKeep(records) });
  }
  return out.sort((a, b) => b.records.length - a.records.length || a.key.localeCompare(b.key));
}

/**
 * Merge one group into the kept record (Owner only, only when pressed). Moves orders, texts, re-enrollment requests,
 * invoices, campaign sends, emails, spoken answers and files; adds notes and missing email/address; a STOP on any record
 * wins. The other records are kept, marked "merged into" the kept one. Nothing is deleted.
 */
export async function mergeCustomers(keepId: number, otherIds: number[], userId: number | null) {
  const others = otherIds.filter((id) => id !== keepId);
  if (!others.length) return { moved: 0 };
  return db.transaction(async (tx) => {
    const all = await tx.select().from(schema.customers).where(inArray(schema.customers.id, [keepId, ...others]));
    const keep = all.find((c) => c.id === keepId);
    if (!keep) throw new Error("The record to keep was not found.");
    const rest = all.filter((c) => c.id !== keepId && !c.mergedIntoId);
    const ids = rest.map((c) => c.id);
    if (!ids.length) return { moved: 0 };
    let moved = 0;
    const move = async (t: { customerId: unknown }) => {
      const r = await tx
        .update(t as typeof schema.orders)
        .set({ customerId: keepId } as never)
        .where(inArray((t as typeof schema.orders).customerId, ids))
        .returning({ id: (t as typeof schema.orders).id });
      moved += r.length;
    };
    for (const t of [schema.orders, schema.messages, schema.smsReenrollRequests, schema.bookInvoices, schema.smsCampaignSends, schema.inboxEmails, schema.spokenAnswers, schema.messageFiles]) await move(t as never);
    const extraNotes = rest
      .map((c) => [c.notes?.trim(), c.phone && c.phone !== keep.phone ? `Also used phone ${c.phone}` : null, c.email && c.email !== keep.email ? `Also used email ${c.email}` : null].filter(Boolean).join(". "))
      .filter(Boolean);
    await tx
      .update(schema.customers)
      .set({
        notes: [keep.notes?.trim(), ...extraNotes].filter(Boolean).join("\n") || null,
        email: keep.email || rest.find((c) => c.email)?.email || null,
        address: keep.address || rest.find((c) => c.address)?.address || null,
        name: keep.name || rest.find((c) => c.name)?.name || null,
        // a STOP on any record wins
        ...(rest.some((c) => c.smsOptOut) ? { smsOptOut: true, marketingOptIn: false } : {}),
      })
      .where(eq(schema.customers.id, keepId));
    await tx.update(schema.customers).set({ mergedIntoId: keepId }).where(inArray(schema.customers.id, ids));
    await tx.insert(schema.auditLog).values({ userId, action: "customers.merged", entityType: "customer", entityId: String(keepId), before: { merged: ids }, after: { keepId, moved } });
    return { moved };
  });
}
