import { and, arrayContains, asc, desc, eq, gt, gte, ilike, isNotNull, isNull, lte, not, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/**
 * Gmail-style Inbox (Abraham, Nov 15, 2026), in our own colors. Folders like Gmail; Trash only hides an email (nothing
 * is ever deleted, as before). Owner only.
 */
export const FOLDERS = [
  { key: "inbox", label: "Inbox" },
  { key: "starred", label: "Starred" },
  { key: "snoozed", label: "Snoozed" },
  { key: "sent", label: "Sent" },
  { key: "drafts", label: "Drafts" },
  // Emails that only ask for the catalog (Abraham, Nov 19, 2026): their own folder, not in the Inbox
  { key: "catalog", label: "Catalog requests" },
  // Under "More", like Gmail (Abraham, Nov 19, 2026)
  { key: "important", label: "Important", more: true },
  { key: "scheduled", label: "Scheduled", more: true },
  { key: "all", label: "All mail", more: true },
  { key: "archive", label: "Archive", more: true },
  { key: "spam", label: "Spam", more: true },
  { key: "trash", label: "Trash", more: true },
] as const;
export type Folder = (typeof FOLDERS)[number]["key"];
export const PAGE_SIZE = 50;

export const isFolder = (f: string | undefined): f is Folder => FOLDERS.some((x) => x.key === f);

const e = schema.inboxEmails;

/** An email that only asks for the catalog: the same rule as the catalog auto-reply (isCatalogSubject). */
export const CATALOG_SUBJECT_SQL = "^\\s*((re|fwd?)\\s*:\\s*)*catalog(ue)?\\s*[.!]?\\s*$";
const isCatalogEmail = sql`coalesce(${e.subject}, '') ~* ${CATALOG_SUBJECT_SQL}`;
const notCatalogEmail = sql`NOT (coalesce(${e.subject}, '') ~* ${CATALOG_SUBJECT_SQL})`;

/** Snoozed emails come back to the Inbox by themselves when their time comes (checked on every look; no job needed). */
const notSnoozed = (now: Date) => or(isNull(e.snoozedUntil), lte(e.snoozedUntil, now));

export function folderWhere(folder: Folder, now = new Date()): SQL | undefined {
  switch (folder) {
    case "inbox":
      return and(isNull(e.archivedAt), isNull(e.trashedAt), isNull(e.spamAt), notSnoozed(now), notCatalogEmail);
    case "catalog":
      return and(isNull(e.trashedAt), isNull(e.spamAt), isCatalogEmail);
    case "starred":
      return and(eq(e.starred, true), isNull(e.trashedAt), isNull(e.spamAt));
    case "snoozed":
      return and(gt(e.snoozedUntil, now), isNull(e.trashedAt), isNull(e.spamAt));
    case "important":
      return and(eq(e.important, true), isNull(e.trashedAt), isNull(e.spamAt));
    case "archive":
      return and(isNotNull(e.archivedAt), isNull(e.trashedAt), isNull(e.spamAt));
    case "spam":
      return and(isNotNull(e.spamAt), isNull(e.trashedAt));
    case "trash":
      return isNotNull(e.trashedAt);
    default:
      return and(isNull(e.trashedAt), isNull(e.spamAt)); // all mail
  }
}

/**
 * Search, like Gmail's search bar and chips (Abraham, Nov 19, 2026): words anywhere, and From, To, Subject, Has the
 * words, Doesn't have, Any time (1 day, 1 week, 1 month, 1 year), Has attachment, Is unread.
 */
export type MailFilters = { q?: string; from?: string; to?: string; subject?: string; has?: string; not?: string; within?: string; attach?: boolean; unread?: boolean; sort?: "recent" | "relevant" };
export const WITHIN = [
  { key: "1d", label: "Older than a day", days: 1, title: "Past day" },
  { key: "7d", label: "Past week", days: 7, title: "Past week" },
  { key: "1m", label: "Past month", days: 31, title: "Past month" },
  { key: "1y", label: "Past year", days: 366, title: "Past year" },
] as const;
const like = (s: string) => `%${s.replace(/[%_]/g, (c) => `\\${c}`)}%`;
const words = (s?: string) => (s ?? "").trim().split(/\s+/).filter(Boolean);
export const hasFilters = (f: MailFilters) => Boolean(f.q || f.from || f.to || f.subject || f.has || f.not || f.within || f.attach || f.unread);

export function filterWhere(f: MailFilters, now = new Date()): SQL | undefined {
  const parts: (SQL | undefined)[] = [];
  for (const w of [...words(f.q), ...words(f.has)]) parts.push(or(ilike(e.fromAddress, like(w)), ilike(e.fromName, like(w)), ilike(e.subject, like(w)), ilike(e.textBody, like(w)), ilike(e.htmlBody, like(w))));
  for (const w of words(f.not)) parts.push(not(or(ilike(e.subject, like(w)), ilike(sql`coalesce(${e.textBody}, '')`, like(w)))!));
  if (f.from?.trim()) parts.push(or(ilike(e.fromAddress, like(f.from.trim())), ilike(e.fromName, like(f.from.trim()))));
  if (f.to?.trim()) parts.push(ilike(e.toAddress, like(f.to.trim())));
  if (f.subject?.trim()) parts.push(ilike(e.subject, like(f.subject.trim())));
  const w = WITHIN.find((x) => x.key === f.within);
  if (w) parts.push(gte(e.receivedAt, new Date(now.getTime() - w.days * 86_400_000)));
  if (f.attach) parts.push(sql`EXISTS (SELECT 1 FROM inbox_files f WHERE f.email_id = ${e.id})`);
  if (f.unread) parts.push(isNull(e.readAt));
  return parts.length ? and(...parts) : undefined;
}

/**
 * Conversations, like Gmail (Abraham, Nov 19, 2026): emails from the same person with the same subject (without "Re:" or
 * "Fwd:") are one conversation. The list shows each conversation once, by its newest email, with how many messages it
 * has (emails and our replies).
 */
export const threadSubject = (subject: string | null | undefined) => (subject ?? "").replace(/^\s*((re|fwd?|fw)\s*:\s*)+/i, "").trim().toLowerCase();
export const threadKey = (x: { subject: string | null; fromAddress: string }) => `${threadSubject(x.subject)}|${x.fromAddress.trim().toLowerCase()}`;

/** The emails of one conversation (oldest first), not in Trash. */
export async function threadEmails(x: { subject: string | null; fromAddress: string }) {
  const rows = await db.select().from(e).where(and(eq(sql`lower(${e.fromAddress})`, x.fromAddress.trim().toLowerCase()), isNull(e.trashedAt))).orderBy(asc(e.receivedAt), asc(e.id));
  return rows.filter((r) => threadKey(r) === threadKey(x));
}

/** One row per conversation: the newest email of each, how many messages, and whether we have a draft reply. */
export async function listThreads(opts: { folder: Folder; label?: string; page?: number; filters?: MailFilters; now?: Date }) {
  const f: MailFilters = opts.filters ?? {};
  const now = opts.now ?? new Date();
  const where = and(
    hasFilters(f) && opts.folder === "inbox" ? folderWhere("all", now) : folderWhere(opts.folder, now),
    opts.label ? arrayContains(e.labels, [opts.label]) : undefined,
    filterWhere(f, now),
  );
  const light = await db.select({ id: e.id, subject: e.subject, fromAddress: e.fromAddress, receivedAt: e.receivedAt, readAt: e.readAt }).from(e).where(where).orderBy(desc(e.receivedAt), desc(e.id));
  const groups = new Map<string, number[]>();
  const unread = new Set(light.filter((r) => !r.readAt).map((r) => r.id));
  for (const r of light) groups.set(threadKey(r), [...(groups.get(threadKey(r)) ?? []), r.id]);
  const heads = [...groups.values()].map((ids) => ({ id: ids[0], ids }));
  const page = Math.max(1, opts.page ?? 1);
  const slice = heads.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const allIds = slice.flatMap((h) => h.ids);
  const [rows, replies, drafts] = allIds.length
    ? await Promise.all([
        db.select().from(e).where(sql`${e.id} IN (${sql.join(slice.map((h) => sql`${h.id}`), sql`, `)})`),
        db.select({ emailId: schema.inboxReplies.emailId }).from(schema.inboxReplies).where(sql`${schema.inboxReplies.emailId} IN (${sql.join(allIds.map((i) => sql`${i}`), sql`, `)})`),
        db.select({ emailId: schema.inboxDrafts.replyToEmailId }).from(schema.inboxDrafts).where(and(isNull(schema.inboxDrafts.discardedAt), isNull(schema.inboxDrafts.sentReplyId), sql`${schema.inboxDrafts.replyToEmailId} IN (${sql.join(allIds.map((i) => sql`${i}`), sql`, `)})`)),
      ])
    : [[], [], []];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const threads = slice.map((h) => {
    const head = byId.get(h.id)!;
    const sent = replies.filter((r) => r.emailId && h.ids.includes(r.emailId)).length;
    return { ...head, count: h.ids.length + sent, hasDraft: drafts.some((d) => d.emailId && h.ids.includes(d.emailId)), sentByUs: sent > 0, unreadAny: h.ids.some((i) => unread.has(i)), ids: h.ids };
  });
  return { rows: threads, total: heads.length, page };
}

/** Received emails in a folder (optionally one label and a search), newest first, one page at a time. */
export async function listEmails(opts: { folder: Folder; q?: string; label?: string; page?: number; filters?: MailFilters; now?: Date }) {
  const f: MailFilters = { ...(opts.filters ?? {}), q: opts.filters?.q ?? opts.q };
  const now = opts.now ?? new Date();
  const where = and(
    // A search looks in every folder except Trash and Spam, like Gmail
    hasFilters(f) && opts.folder === "inbox" ? folderWhere("all", now) : folderWhere(opts.folder, now),
    opts.label ? arrayContains(e.labels, [opts.label]) : undefined,
    filterWhere(f, now),
  );
  const page = Math.max(1, opts.page ?? 1);
  // "Most relevant": the subject or sender matching the words first; otherwise newest first
  const term = words(f.q).join(" ");
  const relevant = f.sort === "relevant" && term ? sql`CASE WHEN ${e.subject} ILIKE ${like(term)} OR ${e.fromName} ILIKE ${like(term)} OR ${e.fromAddress} ILIKE ${like(term)} THEN 0 ELSE 1 END` : null;
  const order = relevant ? [asc(relevant), desc(e.receivedAt), desc(e.id)] : [desc(e.receivedAt), desc(e.id)];
  const [rows, [count]] = await Promise.all([
    db.select().from(e).where(where).orderBy(...order).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE),
    db.select({ n: sql<number>`count(*)::int` }).from(e).where(where),
  ]);
  return { rows, total: count?.n ?? 0, page };
}

/** Everything sent from Admin: replies and new emails. */
export async function listSent(opts: { q?: string; page?: number }) {
  const r = schema.inboxReplies;
  const term = opts.q?.trim();
  const where = term ? or(ilike(r.toAddress, `%${term}%`), ilike(r.subject, `%${term}%`), ilike(r.body, `%${term}%`)) : undefined;
  const page = Math.max(1, opts.page ?? 1);
  const [rows, [count]] = await Promise.all([
    db.select().from(r).where(where).orderBy(desc(r.createdAt), desc(r.id)).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE),
    db.select({ n: sql<number>`count(*)::int` }).from(r).where(where),
  ]);
  return { rows, total: count?.n ?? 0, page };
}

export async function listDrafts() {
  const d = schema.inboxDrafts;
  return db.select().from(d).where(and(isNull(d.discardedAt), isNull(d.sentReplyId), isNull(d.sendAt))).orderBy(desc(d.updatedAt));
}

/** Scheduled emails (Schedule send): waiting for their time. */
export async function listScheduled() {
  const d = schema.inboxDrafts;
  return db.select().from(d).where(and(isNull(d.discardedAt), isNull(d.sentReplyId), isNotNull(d.sendAt))).orderBy(asc(d.sendAt));
}

/** The counts beside each folder, like Gmail: unread in Inbox, and how many drafts. */
export async function folderCounts(now = new Date()) {
  const d = schema.inboxDrafts;
  const n = sql<number>`count(*)::int`;
  const [[unread], [drafts], [scheduled], [spam], [snoozed], [catalog]] = await Promise.all([
    db.select({ n }).from(e).where(and(isNull(e.readAt), folderWhere("inbox", now))),
    db.select({ n }).from(d).where(and(isNull(d.discardedAt), isNull(d.sentReplyId), isNull(d.sendAt))),
    db.select({ n }).from(d).where(and(isNull(d.discardedAt), isNull(d.sentReplyId), isNotNull(d.sendAt))),
    db.select({ n }).from(e).where(and(isNull(e.readAt), folderWhere("spam", now))),
    db.select({ n }).from(e).where(folderWhere("snoozed", now)),
    db.select({ n }).from(e).where(and(isNull(e.readAt), folderWhere("catalog", now))),
  ]);
  return { inbox: unread?.n ?? 0, drafts: drafts?.n ?? 0, scheduled: scheduled?.n ?? 0, spam: spam?.n ?? 0, snoozed: snoozed?.n ?? 0, catalog: catalog?.n ?? 0 };
}

/**
 * Snooze times, like Gmail (Eastern time): later today (6:00 PM, or 3 hours from now after 3 PM), tomorrow 8:00 AM,
 * this weekend (Sunday 8:00 AM; Shabbes is never offered), next week (Monday 8:00 AM).
 */
export function snoozeOptions(now = new Date()): { key: string; label: string; at: Date }[] {
  const tz = "America/New_York";
  const ymd = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: tz });
  const offsetMin = (d: Date) => {
    const local = new Date(d.toLocaleString("en-US", { timeZone: tz }));
    return Math.round((local.getTime() - new Date(d.toLocaleString("en-US", { timeZone: "UTC" })).getTime()) / 60000);
  };
  const at = (iso: string, h: number) => {
    const guess = new Date(`${iso}T${String(h).padStart(2, "0")}:00:00Z`);
    return new Date(guess.getTime() - offsetMin(guess) * 60000);
  };
  const addDays = (iso: string, n: number) => {
    const d = new Date(`${iso}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const today = ymd(now);
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  const six = at(today, 18);
  const later = six.getTime() - now.getTime() > 60 * 60_000 ? six : new Date(now.getTime() + 3 * 3600_000);
  const sunday = addDays(today, dow === 0 ? 7 : 7 - dow);
  const monday = addDays(today, ((8 - dow) % 7) || 7);
  return [
    { key: "later", label: "Later today", at: later },
    { key: "tomorrow", label: "Tomorrow", at: at(addDays(today, 1), 8) },
    { key: "weekend", label: "This weekend (Sunday)", at: at(sunday, 8) },
    { key: "nextweek", label: "Next week", at: at(monday, 8) },
  ];
}

export const BULK_ACTIONS = ["read", "unread", "star", "unstar", "archive", "inbox", "trash", "restore", "label", "unlabel", "important", "unimportant", "spam", "notspam", "snooze", "unsnooze"] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];

/** One action on many emails at once (the check boxes). */
export async function bulkEmails(ids: number[], action: BulkAction, label?: string, snoozeUntil?: Date | null) {
  const list = ids.filter((n) => Number.isInteger(n) && n > 0);
  if (!list.length) return 0;
  const inList = sql`${e.id} IN (${sql.join(list.map((n) => sql`${n}`), sql`, `)})`;
  const now = new Date();
  const set: Partial<typeof e.$inferInsert> | null =
    action === "read" ? { readAt: now }
    : action === "unread" ? { readAt: null }
    : action === "star" ? { starred: true }
    : action === "unstar" ? { starred: false }
    : action === "archive" ? { archivedAt: now }
    : action === "inbox" ? { archivedAt: null, trashedAt: null }
    : action === "trash" ? { trashedAt: now }
    : action === "restore" ? { trashedAt: null }
    : action === "important" ? { important: true }
    : action === "unimportant" ? { important: false }
    : action === "spam" ? { spamAt: now }
    : action === "notspam" ? { spamAt: null }
    : action === "unsnooze" ? { snoozedUntil: null }
    : action === "snooze" ? (snoozeUntil && snoozeUntil > now ? { snoozedUntil: snoozeUntil } : (() => { throw new Error("Choose a snooze time in the future."); })())
    : null;
  if (set) {
    await db.update(e).set(set).where(inList);
    return list.length;
  }
  const name = (label ?? "").trim();
  if (!name) throw new Error("Choose a label.");
  if (action === "label") await db.update(e).set({ labels: sql`(SELECT ARRAY(SELECT DISTINCT unnest(array_append(${e.labels}, ${name}))))` }).where(inList);
  else await db.update(e).set({ labels: sql`array_remove(${e.labels}, ${name})` }).where(inList);
  return list.length;
}

export const LABEL_COLORS = ["#2585D8", "#164B82", "#FFD229", "#13895C", "#C83A2F", "#7A5AC8"];

export async function listLabels() {
  return db.select().from(schema.inboxLabels).orderBy(schema.inboxLabels.name);
}

export async function createLabel(name: string, color?: string) {
  const n = name.trim().slice(0, 40);
  if (!n) throw new Error("Give the label a name.");
  const c = LABEL_COLORS.includes(color ?? "") ? color! : LABEL_COLORS[0];
  await db.insert(schema.inboxLabels).values({ name: n, color: c }).onConflictDoNothing();
}

/** Removing a label takes it off every email; the emails themselves stay. */
export async function removeLabel(name: string) {
  await db.update(e).set({ labels: sql`array_remove(${e.labels}, ${name})` }).where(arrayContains(e.labels, [name]));
  await db.delete(schema.inboxLabels).where(eq(schema.inboxLabels.name, name));
}

/** Drafts save by themselves while writing (Gmail-style). Returns the draft id. */
export async function saveDraft(input: { id?: number | null; to: string; subject: string; body: string; replyTo?: number | null; forwardOf?: number | null; userId: number | null }) {
  const d = schema.inboxDrafts;
  const values = { toAddress: input.to.slice(0, 300), subject: input.subject.slice(0, 300), body: input.body.slice(0, 100_000), updatedAt: new Date() };
  if (input.id) {
    const [row] = await db.update(d).set(values).where(and(eq(d.id, input.id), isNull(d.sentReplyId), isNull(d.discardedAt))).returning({ id: d.id });
    if (row) return row.id;
  }
  const [row] = await db.insert(d).values({ ...values, replyToEmailId: input.replyTo ?? null, forwardOfEmailId: input.forwardOf ?? null, userId: input.userId }).returning({ id: d.id });
  return row.id;
}

export async function getDraft(id: number) {
  const [row] = await db.select().from(schema.inboxDrafts).where(eq(schema.inboxDrafts.id, id)).limit(1);
  return row ?? null;
}

export async function discardDraft(id: number) {
  await db.update(schema.inboxDrafts).set({ discardedAt: new Date() }).where(eq(schema.inboxDrafts.id, id));
}

export async function draftSent(id: number, replyId: number) {
  await db.update(schema.inboxDrafts).set({ sentReplyId: replyId }).where(eq(schema.inboxDrafts.id, id));
}

/** "Fwd:" subject and the quoted original, like Gmail. */
export function forwardText(email: { fromName: string | null; fromAddress: string; subject: string | null; receivedAt: Date; textBody: string | null; toAddress: string | null }) {
  const when = email.receivedAt.toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "full", timeStyle: "short" });
  return {
    subject: /^fwd?:/i.test(email.subject ?? "") ? email.subject! : `Fwd: ${email.subject ?? ""}`.trim(),
    body: `\n\n---------- Forwarded message ----------\nFrom: ${email.fromName ? `${email.fromName} <${email.fromAddress}>` : email.fromAddress}\nDate: ${when}\nSubject: ${email.subject ?? ""}\nTo: ${email.toAddress ?? ""}\n\n${email.textBody ?? ""}`,
  };
}

/** "Mark all as read", like Gmail's More menu: every unread email in the folder (or label). */
export async function markAllRead(folder: Folder, label?: string) {
  await db.update(e).set({ readAt: new Date() }).where(and(isNull(e.readAt), folderWhere(folder), label ? arrayContains(e.labels, [label]) : undefined));
}

/** Rename a label (every email keeps it under the new name) or change its color. */
export async function editLabel(oldName: string, name: string, color: string) {
  const n = name.trim().slice(0, 40);
  if (!n) throw new Error("Give the label a name.");
  const c = LABEL_COLORS.includes(color) ? color : LABEL_COLORS[0];
  await db.update(schema.inboxLabels).set({ name: n, color: c }).where(eq(schema.inboxLabels.name, oldName));
  if (n !== oldName) await db.update(e).set({ labels: sql`array_replace(${e.labels}, ${oldName}, ${n})` }).where(arrayContains(e.labels, [oldName]));
}

/** Schedule send: the draft (with its files and the catalog) waits for its time. */
export async function scheduleDraft(input: { id?: number | null; to: string; subject: string; body: string; fileIds: number[]; attachCatalog: boolean; forwardOf?: number | null; sendAt: Date; userId: number | null; bodyHtml?: string | null }) {
  if (!(input.sendAt.getTime() > Date.now())) throw new Error("Choose a time in the future.");
  const id = await saveDraft({ id: input.id ?? null, to: input.to, subject: input.subject, body: input.body, forwardOf: input.forwardOf ?? null, userId: input.userId });
  await db.update(schema.inboxDrafts).set({ sendAt: input.sendAt, fileIds: input.fileIds, attachCatalog: input.attachCatalog, sendError: null, bodyHtml: input.bodyHtml ?? null }).where(eq(schema.inboxDrafts.id, id));
  return id;
}

/** Cancel a scheduled send: it goes back to Drafts. */
export async function unscheduleDraft(id: number) {
  await db.update(schema.inboxDrafts).set({ sendAt: null }).where(and(eq(schema.inboxDrafts.id, id), isNull(schema.inboxDrafts.sentReplyId)));
}
