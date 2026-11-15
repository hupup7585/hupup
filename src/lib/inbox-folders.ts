import { and, arrayContains, desc, eq, ilike, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/**
 * Gmail-style Inbox (Abraham, Nov 15, 2026), in our own colors. Folders like Gmail; Trash only hides an email (nothing
 * is ever deleted, as before). Owner only.
 */
export const FOLDERS = [
  { key: "inbox", label: "Inbox" },
  { key: "starred", label: "Starred" },
  { key: "sent", label: "Sent" },
  { key: "drafts", label: "Drafts" },
  { key: "all", label: "All mail" },
  { key: "archive", label: "Archive" },
  { key: "trash", label: "Trash" },
] as const;
export type Folder = (typeof FOLDERS)[number]["key"];
export const PAGE_SIZE = 50;

export const isFolder = (f: string | undefined): f is Folder => FOLDERS.some((x) => x.key === f);

const e = schema.inboxEmails;

function folderWhere(folder: Folder): SQL | undefined {
  switch (folder) {
    case "inbox":
      return and(isNull(e.archivedAt), isNull(e.trashedAt));
    case "starred":
      return and(eq(e.starred, true), isNull(e.trashedAt));
    case "archive":
      return and(isNotNull(e.archivedAt), isNull(e.trashedAt));
    case "trash":
      return isNotNull(e.trashedAt);
    default:
      return isNull(e.trashedAt); // all mail
  }
}

/** Received emails in a folder (optionally one label and a search), newest first, one page at a time. */
export async function listEmails(opts: { folder: Folder; q?: string; label?: string; page?: number }) {
  const term = opts.q?.trim();
  const where = and(
    folderWhere(opts.folder),
    opts.label ? arrayContains(e.labels, [opts.label]) : undefined,
    term ? or(ilike(e.fromAddress, `%${term}%`), ilike(e.fromName, `%${term}%`), ilike(e.subject, `%${term}%`), ilike(e.textBody, `%${term}%`)) : undefined,
  );
  const page = Math.max(1, opts.page ?? 1);
  const [rows, [count]] = await Promise.all([
    db.select().from(e).where(where).orderBy(desc(e.receivedAt), desc(e.id)).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE),
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
  return db.select().from(d).where(and(isNull(d.discardedAt), isNull(d.sentReplyId))).orderBy(desc(d.updatedAt));
}

/** The counts beside each folder, like Gmail: unread in Inbox, and how many drafts. */
export async function folderCounts() {
  const [[unread], [drafts]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(e).where(and(isNull(e.readAt), isNull(e.archivedAt), isNull(e.trashedAt))),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.inboxDrafts).where(and(isNull(schema.inboxDrafts.discardedAt), isNull(schema.inboxDrafts.sentReplyId))),
  ]);
  return { inbox: unread?.n ?? 0, drafts: drafts?.n ?? 0 };
}

export const BULK_ACTIONS = ["read", "unread", "star", "unstar", "archive", "inbox", "trash", "restore", "label", "unlabel"] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];

/** One action on many emails at once (the check boxes). */
export async function bulkEmails(ids: number[], action: BulkAction, label?: string) {
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
