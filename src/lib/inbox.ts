import PostalMime from "postal-mime";
import { asc, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { config } from "@/lib/config";
import { sendEmail, EMAIL_REPLY_TO } from "@/lib/notify";
import { handleCatalogEmail } from "@/lib/catalog-send";

/**
 * info@hupupattractions.com Inbox (Abraham, Nov 12, 2026). Owner only. Every email and every reply is kept; nothing
 * is ever deleted. Mail arrives from a Cloudflare Email Worker that forwards to Gmail first and then sends the full
 * original email here in pieces (Vercel takes at most 4.5 MB per request). Attachments up to 10 MB are kept and can
 * be opened; bigger ones are listed (the Gmail copy has them).
 */
export const INBOX_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const INBOX_CHUNK_BYTES = 3 * 1024 * 1024;
const RAW_MAX_BYTES = 30 * 1024 * 1024;

export type InboxEmail = typeof schema.inboxEmails.$inferSelect;

/** One piece of an incoming email; the last piece to arrive puts the email together and files it. */
export async function receiveRawPiece(uploadId: string, idx: number, parts: number, data: Buffer) {
  if (!/^[A-Za-z0-9-]{8,80}$/.test(uploadId) || !Number.isInteger(idx) || !Number.isInteger(parts) || parts < 1 || parts > 12 || idx < 0 || idx >= parts) throw new Error("bad piece");
  if (!data.length || data.length > 4 * 1024 * 1024) throw new Error("bad size");
  await db.insert(schema.inboxRaw).values({ uploadId, parts }).onConflictDoNothing();
  await db.insert(schema.inboxRawChunks).values({ uploadId, idx, data }).onConflictDoNothing();
  const chunks = await db.select().from(schema.inboxRawChunks).where(eq(schema.inboxRawChunks.uploadId, uploadId)).orderBy(asc(schema.inboxRawChunks.idx));
  if (chunks.length < parts) return { complete: false as const };
  const [raw] = await db.select().from(schema.inboxRaw).where(eq(schema.inboxRaw.uploadId, uploadId)).limit(1);
  if (raw?.emailId) return { complete: true as const, emailId: raw.emailId, duplicate: true };
  const bytes = Buffer.concat(chunks.map((c) => c.data));
  if (bytes.length > RAW_MAX_BYTES) throw new Error("too big");
  const email = await fileEmail(bytes, uploadId);
  await db.update(schema.inboxRaw).set({ emailId: email.id }).where(eq(schema.inboxRaw.uploadId, uploadId));
  return { complete: true as const, emailId: email.id, duplicate: false };
}

async function storeFile(input: { emailId?: number | null; fileName: string; contentType: string; data: Buffer; userId?: number | null }) {
  const tooBig = input.data.length > INBOX_FILE_MAX_BYTES;
  const [f] = await db
    .insert(schema.inboxFiles)
    .values({ emailId: input.emailId ?? null, fileName: input.fileName.slice(0, 200) || "attachment", contentType: input.contentType || "application/octet-stream", sizeBytes: input.data.length, tooBig, complete: !tooBig, createdBy: input.userId ?? null })
    .returning();
  if (!tooBig) {
    for (let i = 0; i * INBOX_CHUNK_BYTES < input.data.length; i++) {
      await db.insert(schema.inboxFileChunks).values({ fileId: f.id, idx: i, data: input.data.subarray(i * INBOX_CHUNK_BYTES, (i + 1) * INBOX_CHUNK_BYTES) });
    }
  }
  return f;
}

/** Read the email, keep it (and its attachments up to 10 MB), link the contact, tell Abraham, check for Catalog. */
export async function fileEmail(bytes: Buffer, uploadId: string | null = null, now = new Date()): Promise<InboxEmail> {
  const mail = await PostalMime.parse(bytes);
  const messageId = mail.messageId?.trim() || null;
  if (messageId) {
    const [dupe] = await db.select().from(schema.inboxEmails).where(eq(schema.inboxEmails.messageId, messageId)).limit(1);
    if (dupe) return dupe;
  }
  const from = (mail.from?.address ?? "").trim().toLowerCase() || "unknown";
  const [contact] = from.includes("@") ? await db.select({ id: schema.customers.id }).from(schema.customers).where(sql`lower(${schema.customers.email}) = ${from}`).limit(1) : [];
  const received = mail.date ? new Date(mail.date) : now;
  const [email] = await db
    .insert(schema.inboxEmails)
    .values({
      messageId,
      uploadId,
      fromAddress: from,
      fromName: mail.from?.name?.trim() || null,
      toAddress: (mail.to ?? []).map((t) => t.address).filter(Boolean).join(", ") || null,
      subject: mail.subject?.trim() || null,
      textBody: mail.text ?? null,
      htmlBody: mail.html ?? null,
      receivedAt: Number.isNaN(received.getTime()) ? now : received,
      customerId: contact?.id ?? null,
    })
    .returning();
  for (const a of mail.attachments ?? []) {
    const data = Buffer.from(typeof a.content === "string" ? Buffer.from(a.content, "base64") : new Uint8Array(a.content as ArrayBuffer));
    await storeFile({ emailId: email.id, fileName: a.filename ?? "attachment", contentType: a.mimeType, data });
  }
  // Tell Abraham (the Gmail copy still arrives through the forward as well)
  const owner = process.env.ADMIN_EMAIL;
  if (owner) {
    await sendEmail(
      owner,
      `New email to info@: ${email.subject ?? "(no subject)"}`,
      `New email to info@hupupattractions.com\nFrom: ${email.fromName ? `${email.fromName} <${email.fromAddress}>` : email.fromAddress}\nSubject: ${email.subject ?? "(no subject)"}\n\nOpen the Inbox: ${config.baseUrl()}/admin/inbox/${email.id}`,
    ).catch((e) => console.error("inbox alert failed", e));
  }
  // The info@ "Catalog" auto-reply (off until Abraham approves its wording)
  await handleCatalogEmail(email.fromAddress, email.subject).catch((e) => console.error("catalog check failed", e));
  return email;
}

export async function inboxUnreadCount(): Promise<number> {
  try {
    const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.inboxEmails).where(isNull(schema.inboxEmails.readAt));
    return r?.n ?? 0;
  } catch {
    return 0;
  }
}

export async function listInbox(q?: string, limit = 200) {
  const term = q?.trim();
  const where = term
    ? or(ilike(schema.inboxEmails.fromAddress, `%${term}%`), ilike(schema.inboxEmails.fromName, `%${term}%`), ilike(schema.inboxEmails.subject, `%${term}%`), ilike(schema.inboxEmails.textBody, `%${term}%`))
    : undefined;
  return db.select().from(schema.inboxEmails).where(where).orderBy(desc(schema.inboxEmails.receivedAt), desc(schema.inboxEmails.id)).limit(limit);
}

export async function getInboxEmail(id: number) {
  const [email] = await db.select().from(schema.inboxEmails).where(eq(schema.inboxEmails.id, id)).limit(1);
  if (!email) return null;
  const files = await db.select().from(schema.inboxFiles).where(eq(schema.inboxFiles.emailId, id)).orderBy(asc(schema.inboxFiles.id));
  const replies = await db.select().from(schema.inboxReplies).where(eq(schema.inboxReplies.emailId, id)).orderBy(asc(schema.inboxReplies.createdAt));
  const replyFiles = replies.length ? await db.select().from(schema.inboxFiles).where(sql`${schema.inboxFiles.replyId} IN (${sql.join(replies.map((r) => sql`${r.id}`), sql`, `)})`) : [];
  const contact = email.customerId ? (await db.select().from(schema.customers).where(eq(schema.customers.id, email.customerId)).limit(1))[0] ?? null : null;
  return { email, files, replies, replyFiles, contact };
}

export async function setRead(id: number, read: boolean) {
  await db.update(schema.inboxEmails).set({ readAt: read ? new Date() : null }).where(eq(schema.inboxEmails.id, id));
}

export async function fileBytes(id: number) {
  const [f] = await db.select().from(schema.inboxFiles).where(eq(schema.inboxFiles.id, id)).limit(1);
  if (!f || !f.complete) return null;
  const chunks = await db.select().from(schema.inboxFileChunks).where(eq(schema.inboxFileChunks.fileId, id)).orderBy(asc(schema.inboxFileChunks.idx));
  return { file: f, data: Buffer.concat(chunks.map((c) => c.data)) };
}

/** Reply attachments are uploaded first (in pieces), then attached when the reply is sent. */
export async function startReplyFile(fileName: string, contentType: string, size: number, userId: number | null) {
  if (size <= 0 || size > INBOX_FILE_MAX_BYTES) throw new Error("Attachments can be up to 10 MB.");
  const [f] = await db.insert(schema.inboxFiles).values({ fileName: fileName.slice(0, 200), contentType: contentType || "application/octet-stream", sizeBytes: size, createdBy: userId }).returning();
  return f;
}

export async function saveReplyFileChunk(fileId: number, idx: number, data: Buffer, last: boolean) {
  if (!data.length || data.length > INBOX_CHUNK_BYTES) throw new Error("That piece of the file didn't arrive.");
  await db.insert(schema.inboxFileChunks).values({ fileId, idx, data }).onConflictDoNothing();
  if (!last) return false;
  const [f] = await db.select().from(schema.inboxFiles).where(eq(schema.inboxFiles.id, fileId)).limit(1);
  const total = (await db.select({ n: sql<number>`coalesce(sum(length(${schema.inboxFileChunks.data})), 0)::int` }).from(schema.inboxFileChunks).where(eq(schema.inboxFileChunks.fileId, fileId)))[0]?.n ?? 0;
  if (!f || total !== f.sizeBytes) return false;
  await db.update(schema.inboxFiles).set({ complete: true }).where(eq(schema.inboxFiles.id, fileId));
  return true;
}

export const REPLY_SIGNATURE = "Hup Up Attractions";

/**
 * Reply from info@ (Resend; hupupattractions.com is verified there). Signed "Hup Up Attractions". Kept with its
 * attachments whether it was sent or not.
 */
export async function sendReply(input: { emailId: number; body: string; fileIds: number[]; userId: number | null }) {
  const found = await getInboxEmail(input.emailId);
  if (!found) throw new Error("Email not found.");
  const body = input.body.trim();
  if (!body) throw new Error("Write a reply first.");
  const files = [];
  for (const id of input.fileIds) {
    const f = await fileBytes(id);
    if (!f || f.file.emailId || f.file.replyId) throw new Error("An attachment didn't upload. Please attach it again.");
    files.push(f);
  }
  if (files.reduce((n, f) => n + f.data.length, 0) > INBOX_FILE_MAX_BYTES) throw new Error("Attachments can be up to 10 MB in all.");
  const e = found.email;
  const subject = /^re:/i.test(e.subject ?? "") ? e.subject! : `Re: ${e.subject ?? ""}`.trim();
  const text = `${body}\n\n${REPLY_SIGNATURE}`;
  const headers = e.messageId ? { "In-Reply-To": e.messageId, References: e.messageId } : undefined;
  const res = await sendEmail(e.fromAddress, subject, text, files.map((f) => ({ filename: f.file.fileName, content: f.data.toString("base64") })), { headers });
  const [reply] = await db
    .insert(schema.inboxReplies)
    .values({ emailId: e.id, toAddress: e.fromAddress, subject, body: text, sent: res.sent, error: res.sent ? null : (res.error ?? "not sent"), userId: input.userId })
    .returning();
  for (const f of files) await db.update(schema.inboxFiles).set({ replyId: reply.id }).where(eq(schema.inboxFiles.id, f.file.id));
  if (!e.readAt) await setRead(e.id, true);
  return reply;
}

/** Replies go out only from the verified domain. */
export function repliesActive(env: Record<string, string | undefined> = process.env) {
  return Boolean(env.RESEND_API_KEY) && (env.EMAIL_FROM ?? "").includes("@hupupattractions.com");
}

export { EMAIL_REPLY_TO };

