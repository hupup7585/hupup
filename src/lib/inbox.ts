import { htmlToText } from "@/lib/inbox-format";
import PostalMime from "postal-mime";
import { and, asc, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { config } from "@/lib/config";
import { sendEmail, EMAIL_REPLY_TO } from "@/lib/notify";
import { handleCatalogEmail } from "@/lib/catalog-send";

/**
 * info@hupupattractions.com Inbox (Abraham, Nov 12, 2026). Owner only. Every email and every reply is kept; nothing
 * is ever deleted. Mail arrives from a Cloudflare Email Worker that forwards to Gmail first and then sends the full
 * original email here in pieces (Vercel takes at most 4.5 MB per request). Attachments up to 18 MB are kept and can
 * be opened; bigger ones are listed (the Gmail copy has them).
 */
/**
 * Attachments: up to 18 MB in all per email (Abraham, Nov 14, 2026: "reach the free limit"). Resend takes up to 40 MB
 * free, but Gmail and most inboxes refuse emails over 25 MB, and attachments grow by about a third when sent, so 18 MB
 * is the most that reaches everyone. A received attachment up to 18 MB is kept; bigger ones stay in the Gmail copy.
 */
export const INBOX_FILE_MAX_BYTES = 18 * 1024 * 1024;
export const INBOX_FILE_MAX_LABEL = "18 MB";
/**
 * Attachments are saved in the database, and Neon's free plan holds 1 GB in all. New attachments are refused once the
 * database passes 800 MB, so bookings, calls and payments always have room.
 */
export const ATTACHMENT_STORAGE_STOP_BYTES = 800 * 1024 * 1024;

export async function databaseBytes(): Promise<number> {
  try {
    const r = await db.execute(sql`SELECT pg_database_size(current_database())::bigint AS n`);
    return Number((r.rows[0] as { n: string | number }).n);
  } catch {
    return 0;
  }
}
export const INBOX_CHUNK_BYTES = 3 * 1024 * 1024;
const RAW_MAX_BYTES = 30 * 1024 * 1024;

export type InboxEmail = typeof schema.inboxEmails.$inferSelect;
/** inbox_raw.email_id while the last piece is being filed (no email row has this id). */
const FILING = -1;

/** One piece of an incoming email; the last piece to arrive puts the email together and files it. */
export async function receiveRawPiece(uploadId: string, idx: number, parts: number, data: Buffer, envelopeFrom: string | null = null) {
  if (!/^[A-Za-z0-9-]{8,80}$/.test(uploadId) || !Number.isInteger(idx) || !Number.isInteger(parts) || parts < 1 || parts > 12 || idx < 0 || idx >= parts) throw new Error("bad piece");
  if (!data.length || data.length > 4 * 1024 * 1024) throw new Error("bad size");
  await db.insert(schema.inboxRaw).values({ uploadId, parts }).onConflictDoNothing();
  await db.insert(schema.inboxRawChunks).values({ uploadId, idx, data }).onConflictDoNothing();
  const chunks = await db.select().from(schema.inboxRawChunks).where(eq(schema.inboxRawChunks.uploadId, uploadId)).orderBy(asc(schema.inboxRawChunks.idx));
  if (chunks.length < parts) return { complete: false as const };
  const bytes = Buffer.concat(chunks.map((c) => c.data));
  if (bytes.length > RAW_MAX_BYTES) throw new Error("too big");
  // Extra check E9 (Nov 27, 2026): the last piece claims the upload first (email_id -1 = being filed), so two last
  // pieces at once, or a retry while it is being filed, never file the email twice or alert the Owner twice.
  const claimed = await db
    .update(schema.inboxRaw)
    .set({ emailId: FILING })
    .where(and(eq(schema.inboxRaw.uploadId, uploadId), isNull(schema.inboxRaw.emailId)))
    .returning({ uploadId: schema.inboxRaw.uploadId });
  if (!claimed.length) {
    const [raw] = await db.select().from(schema.inboxRaw).where(eq(schema.inboxRaw.uploadId, uploadId)).limit(1);
    return { complete: true as const, emailId: raw?.emailId ?? FILING, duplicate: true };
  }
  let email: InboxEmail;
  try {
    email = await fileEmail(bytes, uploadId, new Date(), envelopeFrom);
  } catch (e) {
    // not filed: free the claim so the worker's retry can try again
    await db.update(schema.inboxRaw).set({ emailId: null }).where(and(eq(schema.inboxRaw.uploadId, uploadId), eq(schema.inboxRaw.emailId, FILING)));
    throw e;
  }
  await db.update(schema.inboxRaw).set({ emailId: email.id }).where(eq(schema.inboxRaw.uploadId, uploadId));
  return { complete: true as const, emailId: email.id, duplicate: false };
}

async function storeFile(input: { emailId?: number | null; fileName: string; contentType: string; data: Buffer; userId?: number | null }) {
  // Deep check C1: past the 800 MB stop the file is listed but not kept, so bookings, calls and payments keep room
  const tooBig = input.data.length > INBOX_FILE_MAX_BYTES || (await databaseBytes()) + input.data.length > ATTACHMENT_STORAGE_STOP_BYTES;
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

/** The address a reply goes to: the email's Reply-To when it has a usable one (like Gmail), otherwise From. */
export function replyToOf(mail: { replyTo?: { address?: string }[] | null }, from: string): string {
  const r = (mail.replyTo ?? []).map((a) => (a.address ?? "").trim().toLowerCase()).find((a) => /^[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]{2,}$/.test(a));
  return r ?? from;
}

/** Deep check C5: Reply-To from the original email (kept in pieces), read when replying; From when there is none. */
export async function replyAddressFor(e: { uploadId: string | null; fromAddress: string }): Promise<string> {
  if (!e.uploadId) return e.fromAddress;
  try {
    const chunks = await db.select().from(schema.inboxRawChunks).where(eq(schema.inboxRawChunks.uploadId, e.uploadId)).orderBy(asc(schema.inboxRawChunks.idx));
    if (!chunks.length) return e.fromAddress;
    return replyToOf(await PostalMime.parse(Buffer.concat(chunks.map((c) => c.data))), e.fromAddress);
  } catch {
    return e.fromAddress;
  }
}

/** Read the email, keep it (and its attachments up to 18 MB), link the contact, tell Abraham, check for Catalog. */
export async function fileEmail(bytes: Buffer, uploadId: string | null = null, now = new Date(), envelopeFrom: string | null = null): Promise<InboxEmail> {
  const mail = await PostalMime.parse(bytes);
  const messageId = mail.messageId?.trim() || null;
  if (messageId) {
    const [dupe] = await db.select().from(schema.inboxEmails).where(eq(schema.inboxEmails.messageId, messageId)).limit(1);
    if (dupe) return dupe;
  }
  // A retry of the same upload (an earlier try saved the email, then failed on an attachment): the email is kept once
  if (uploadId) {
    const [dupe] = await db.select().from(schema.inboxEmails).where(eq(schema.inboxEmails.uploadId, uploadId)).limit(1);
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
  // Every info@ email texted to the Owner's cell with the sender, subject and message (Abraham, Nov 17, 2026)
  await textOwnerAboutEmail(email).catch((e) => console.error("inbox text alert failed", e));
  // The info@ "Catalog" auto-reply (off until Abraham approves its wording)
  // Extra check E5 (Nov 27, 2026): the From line can be written by anyone. When the email worker tells us the real
  // (envelope) sender and it is a different address, no catalog is sent to the From line (the email is still kept).
  if (catalogReplyAllowed(email.fromAddress, envelopeFrom)) await handleCatalogEmail(email.fromAddress, email.subject).catch((e) => console.error("catalog check failed", e));
  else console.warn("[inbound email] catalog auto-reply skipped: the From line does not match the real sender");
  return email;
}

/** The Catalog auto-reply goes to the From line only when it is the real sender (or the worker did not say). */
export function catalogReplyAllowed(fromAddress: string, envelopeFrom: string | null | undefined): boolean {
  const env = (envelopeFrom ?? "").trim().toLowerCase();
  if (!env) return true; // an older worker that does not pass the real sender: as before
  return env === fromAddress.trim().toLowerCase();
}

export async function inboxUnreadCount(): Promise<number> {
  try {
    // Like Gmail: unread emails in the Inbox folder (not archived, Trash, Spam, snoozed or a catalog request)
    const [r] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.inboxEmails)
      .where(and(isNull(schema.inboxEmails.readAt), (await import("@/lib/inbox-folders")).folderWhere("inbox")));
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

/**
 * The files for an outgoing email: up to 18 MB attached as before; larger ones (in R2) become the approved line with a
 * 30-day download link (Abraham, Nov 18, 2026), one line per file.
 */
async function outgoingFiles(ids: number[]) {
  const { fileLink, tooBigLine } = await import("@/lib/file-links");
  const files: NonNullable<Awaited<ReturnType<typeof fileBytes>>>[] = [];
  const linked: number[] = [];
  const lines: string[] = [];
  for (const id of ids) {
    const [row] = await db.select().from(schema.inboxFiles).where(eq(schema.inboxFiles.id, id)).limit(1);
    if (!row || !row.complete || row.emailId || row.replyId) throw new Error("An attachment didn't upload. Please attach it again.");
    if (row.inR2) {
      linked.push(id);
      lines.push(tooBigLine(fileLink(id)));
      continue;
    }
    const f = await fileBytes(id);
    if (!f) throw new Error("An attachment didn't upload. Please attach it again.");
    files.push(f);
  }
  return { files, linked, linkText: lines.length ? `\n\n${lines.join("\n\n")}` : "" };
}

export async function fileBytes(id: number) {
  const [f] = await db.select().from(schema.inboxFiles).where(eq(schema.inboxFiles.id, id)).limit(1);
  if (!f || !f.complete) return null;
  const chunks = await db.select().from(schema.inboxFileChunks).where(eq(schema.inboxFileChunks.fileId, id)).orderBy(asc(schema.inboxFileChunks.idx));
  return { file: f, data: Buffer.concat(chunks.map((c) => c.data)) };
}

/** Reply attachments are uploaded first (in pieces), then attached when the reply is sent. */
export async function startReplyFile(fileName: string, contentType: string, size: number, userId: number | null) {
  const { LINK_FILE_MAX_BYTES, LINK_FILE_MAX_LABEL } = await import("@/lib/file-links");
  if (size <= 0 || size > LINK_FILE_MAX_BYTES) throw new Error(`A file can be up to ${LINK_FILE_MAX_LABEL}.`);
  // Over 18 MB (Abraham, Nov 18, 2026): kept in R2 and sent as a 30-day download link instead of attached
  if (size > INBOX_FILE_MAX_BYTES) {
    const { r2Ready, r2Used, R2_STOP_BYTES } = await import("@/lib/r2");
    if (!r2Ready()) throw new Error(`Files over ${INBOX_FILE_MAX_LABEL} are sent as a link, which needs the R2 storage (not set up here).`);
    if ((await r2Used()) + size > R2_STOP_BYTES) throw new Error("The file storage is nearly full. Please send a smaller file.");
    const [f] = await db.insert(schema.inboxFiles).values({ fileName: fileName.slice(0, 200), contentType: contentType || "application/octet-stream", sizeBytes: size, createdBy: userId, inR2: true }).returning();
    return f;
  }
  if ((await databaseBytes()) + size > ATTACHMENT_STORAGE_STOP_BYTES)
    throw new Error("The storage for attachments is nearly full. Send the file as a link instead, or ask Claude to move files to R2.");
  const [f] = await db.insert(schema.inboxFiles).values({ fileName: fileName.slice(0, 200), contentType: contentType || "application/octet-stream", sizeBytes: size, createdBy: userId }).returning();
  return f;
}

export async function saveReplyFileChunk(fileId: number, idx: number, data: Buffer, last: boolean) {
  if (!data.length || data.length > INBOX_CHUNK_BYTES) throw new Error("That piece of the file didn't arrive.");
  const [big] = await db.select().from(schema.inboxFiles).where(eq(schema.inboxFiles.id, fileId)).limit(1);
  if (big?.inR2) {
    // A large file: each 3 MB piece is its own R2 object; done when every byte has arrived
    const { r2Put } = await import("@/lib/r2");
    const { linkPieceKey } = await import("@/lib/file-links");
    await r2Put(linkPieceKey(fileId, idx), data, "application/octet-stream");
    const [u] = await db
      .update(schema.inboxFiles)
      .set({ receivedBytes: sql`${schema.inboxFiles.receivedBytes} + ${data.length}` })
      .where(eq(schema.inboxFiles.id, fileId))
      .returning({ got: schema.inboxFiles.receivedBytes, size: schema.inboxFiles.sizeBytes });
    if (!last || !u || u.got !== u.size) return false;
    await db.update(schema.inboxFiles).set({ complete: true }).where(eq(schema.inboxFiles.id, fileId));
    return true;
  }
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
export async function sendReply(input: { emailId: number; body: string; fileIds: number[]; userId: number | null; bodyHtml?: string | null }) {
  const found = await getInboxEmail(input.emailId);
  if (!found) throw new Error("Email not found.");
  const body = input.body.trim();
  if (!body) throw new Error("Write a reply first.");
  const { files, linked, linkText } = await outgoingFiles(input.fileIds);
  if (files.reduce((n, f) => n + f.data.length, 0) > INBOX_FILE_MAX_BYTES) throw new Error(`Attachments can be up to ${INBOX_FILE_MAX_LABEL} in all.`);
  const e = found.email;
  const subject = /^re:/i.test(e.subject ?? "") ? e.subject! : `Re: ${e.subject ?? ""}`.trim();
  const text = body + linkText; // the logo and signature are added to every email (src/lib/email-brand.ts)
  const headers = e.messageId ? { "In-Reply-To": e.messageId, References: e.messageId } : undefined;
  const to = await replyAddressFor(e); // deep check C5: the email's Reply-To, like Gmail
  const res = await sendEmail(to, subject, text, files.map((f) => ({ filename: f.file.fileName, content: f.data.toString("base64") })), { headers, record: false, bodyHtml: htmlWithLinks(input.bodyHtml, linkText) });
  const [reply] = await db
    .insert(schema.inboxReplies)
    .values({ emailId: e.id, toAddress: to, subject, body: text, sent: res.sent, error: res.sent ? null : (res.error ?? "not sent"), userId: input.userId })
    .returning();
  for (const id of [...files.map((f) => f.file.id), ...linked]) await db.update(schema.inboxFiles).set({ replyId: reply.id }).where(eq(schema.inboxFiles.id, id));
  if (!e.readAt) await setRead(e.id, true);
  return reply;
}

export const validAddress = (a: string) => /^[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]{2,}$/.test(a.trim());

/** A new email written in Admin (Owner), from info@, signed "Hup Up Attractions", attachments up to 18 MB in all. */
export async function sendNewEmail(input: { to: string; subject: string; body: string; fileIds: number[]; userId: number | null; forwardOf?: number | null; attachCatalog?: boolean; bodyHtml?: string | null }) {
  const to = input.to.trim();
  if (!validAddress(to)) throw new Error("Enter one email address to send to.");
  const subject = input.subject.trim();
  if (!subject) throw new Error("Write a subject first.");
  const body = input.body.trim();
  if (!body) throw new Error("Write your email first.");
  const { files, linked, linkText } = await outgoingFiles(input.fileIds);
  // Forward (Gmail-style Inbox): the original email's attachments go along
  const forwarded: { filename: string; content: string }[] = [];
  if (input.forwardOf) {
    const orig = await db.select().from(schema.inboxFiles).where(and(eq(schema.inboxFiles.emailId, input.forwardOf), eq(schema.inboxFiles.complete, true), eq(schema.inboxFiles.tooBig, false)));
    for (const o of orig) {
      const fb = await fileBytes(o.id);
      if (fb) forwarded.push({ filename: fb.file.fileName, content: fb.data.toString("base64") });
    }
  }
  // Compose > Add our catalog (Abraham, Nov 17, 2026): the current catalog PDF from Admin goes along
  if (input.attachCatalog) {
    const { catalogPdfAttachment } = await import("@/lib/catalog-pdf");
    const pdf = await catalogPdfAttachment();
    if (!pdf) throw new Error("No catalog PDF is uploaded yet. Upload it in Admin, Catalog email & text.");
    forwarded.push(pdf);
  }
  // Every catalog email: the "View the catalog" button inside the box, plus the attachment (Abraham, Nov 23, 2026)
  const button = input.attachCatalog ? await (await import("@/lib/catalog-pdf")).catalogButton() : null;
  if (files.reduce((n, f) => n + f.data.length, 0) > INBOX_FILE_MAX_BYTES) throw new Error(`Attachments can be up to ${INBOX_FILE_MAX_LABEL} in all.`);
  if (files.reduce((n, f) => n + f.data.length, 0) + forwarded.reduce((n, f) => n + Buffer.byteLength(f.content, "base64"), 0) > INBOX_FILE_MAX_BYTES)
    throw new Error(`Attachments, with the forwarded ones, can be up to ${INBOX_FILE_MAX_LABEL} in all.`);
  const text = body + linkText; // the logo and signature are added to every email (src/lib/email-brand.ts)
  const res = await sendEmail(to, subject, text, [...files.map((f) => ({ filename: f.file.fileName, content: f.data.toString("base64") })), ...forwarded], { record: false, noThanks: Boolean(input.attachCatalog), bodyHtml: htmlWithLinks(input.bodyHtml, linkText), button });
  const [sent] = await db
    .insert(schema.inboxReplies)
    .values({ emailId: null, toAddress: to, subject, body: text, sent: res.sent, error: res.sent ? null : (res.error ?? "not sent"), userId: input.userId })
    .returning();
  for (const id of [...files.map((f) => f.file.id), ...linked]) await db.update(schema.inboxFiles).set({ replyId: sent.id }).where(eq(schema.inboxFiles.id, id));
  return sent;
}

/** New emails written in Admin, newest first. */
export async function sentNewEmails(limit = 50) {
  return db.select().from(schema.inboxReplies).where(isNull(schema.inboxReplies.emailId)).orderBy(desc(schema.inboxReplies.createdAt)).limit(limit);
}

/** Replies go out only from the verified domain. */
export function repliesActive(env: Record<string, string | undefined> = process.env) {
  return Boolean(env.RESEND_API_KEY) && (env.EMAIL_FROM ?? "").includes("@hupupattractions.com");
}

export { EMAIL_REPLY_TO };


/** The Owner's cell for info@ email texts: 845-777-7585. */
export const INFO_ALERT_PHONE = "+18457777585";
const TEXT_MAX = 1600;

/** The text for one info@ email: sender, subject and message, cut to one text. A cut email ends with the code to get it all. */
export function infoEmailText(e: { id?: number; fromName: string | null; fromAddress: string; subject: string | null; textBody: string | null; htmlBody?: string | null }): string {
  const head = `New email to info@hupupattractions.com\nFrom: ${e.fromName ? `${e.fromName} <${e.fromAddress}>` : e.fromAddress}\nSubject: ${e.subject ?? "(no subject)"}\n\n`;
  const body = cleanEmailBody(emailPlainText(e));
  // Abraham, Nov 18, 2026: reply a code to get the full email by text
  const more = e.id ? `... Reply MORE ${e.id} for the full email.` : "... (more in the Admin inbox)";
  const room = TEXT_MAX - head.length;
  return head + (body.length <= room ? body : body.slice(0, Math.max(0, room - more.length)).trimEnd() + more);
}

/** The email's text; an HTML-only email is turned into text first (Nov 19, 2026: it was "(no text)"). */
const emailPlainText = (e: { textBody: string | null; htmlBody?: string | null }) => (e.textBody?.trim() ? e.textBody : e.htmlBody ? htmlToText(e.htmlBody) : e.textBody);
const cleanEmailBody = (t: string | null) => (t ?? "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim() || "(no text)";

/** The most texts one MORE reply sends; anything longer stays in the Admin inbox. */
export const MORE_MAX_TEXTS = 6;

/**
 * The whole email as texts (Abraham, Nov 18, 2026): each starts "Email 123, part 1 of 3", cut at a space, up to
 * MORE_MAX_TEXTS; a longer email ends with a pointer to the Admin inbox.
 */
export function fullEmailTexts(e: { id: number; fromName: string | null; fromAddress: string; subject: string | null; textBody: string | null; htmlBody?: string | null }): string[] {
  const all = `From: ${e.fromName ? `${e.fromName} <${e.fromAddress}>` : e.fromAddress}\nSubject: ${e.subject ?? "(no subject)"}\n\n${cleanEmailBody(emailPlainText(e))}`;
  const label = (i: number, n: number) => `Email ${e.id}, part ${i} of ${n}\n`;
  const room = TEXT_MAX - label(MORE_MAX_TEXTS, MORE_MAX_TEXTS).length;
  const parts: string[] = [];
  let rest = all;
  while (rest && parts.length < MORE_MAX_TEXTS) {
    if (rest.length <= room) {
      parts.push(rest);
      rest = "";
      break;
    }
    let cut = rest.lastIndexOf(" ", room);
    if (cut < room / 2) cut = room;
    parts.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) {
    const tail = "... (the rest is in the Admin inbox)";
    const last = parts[parts.length - 1];
    parts[parts.length - 1] = last.slice(0, room - tail.length).trimEnd() + tail;
  }
  return parts.map((p, i) => label(i + 1, parts.length) + p);
}

/**
 * "MORE 123" texted from the Owner's cell (845-777-7585): the full email 123 comes back by text. "MORE" alone sends
 * the newest email. Any other number is ignored here (handled as a normal incoming text).
 */
export async function handleMoreRequest(from: string, text: string): Promise<boolean> {
  if (from !== INFO_ALERT_PHONE) return false;
  const m = /^\s*more\s*(\d+)?\s*[.!]?\s*$/i.exec(text);
  if (!m) return false;
  const { sendSms } = await import("@/lib/notify");
  const [e] = m[1]
    ? await db.select().from(schema.inboxEmails).where(eq(schema.inboxEmails.id, Number(m[1]))).limit(1)
    : await db.select().from(schema.inboxEmails).orderBy(desc(schema.inboxEmails.receivedAt)).limit(1);
  if (!e) {
    await sendSms(INFO_ALERT_PHONE, `No email ${m[1] ?? ""} was found in the Admin inbox.`.replace("  ", " "), { kind: "system", event: "info_email_alert" });
    return true;
  }
  for (const part of fullEmailTexts(e)) await sendSms(INFO_ALERT_PHONE, part, { kind: "system", event: "info_email_alert" });
  return true;
}

async function textOwnerAboutEmail(e: { id?: number; fromName: string | null; fromAddress: string; subject: string | null; textBody: string | null }) {
  const { sendSms } = await import("@/lib/notify");
  await sendSms(INFO_ALERT_PHONE, infoEmailText(e), { kind: "system", event: "info_email_alert" });
}

/** A sent email (booking, payment, catalog, alerts...) kept under Sent in the Admin inbox, with its files. */
export async function recordSentEmail(input: { to: string; subject: string; body: string; attachments: { filename: string; content: string }[]; sent: boolean; error: string | null; kind?: "code" | "catalog" | "auto" | "backup" }) {
  // Deep check 30 (Nov 27, 2026): the Sent copy never keeps a working sign-in code (the digits are hidden), and the
  // weekly backup's Sent copy is kept without its file (all customer data stays only in the Owner's email)
  const hide = (t: string) => (input.kind === "code" ? t.replace(/\b\d{4,8}\b/g, "••••••") : t);
  const backup = input.kind === "backup";
  // Deep check C1: the catalog PDF is the same file in every catalog email, so its Sent copy is kept without it
  const catalog = input.kind === "catalog";
  const files = backup || catalog ? [] : input.attachments;
  const body =
    hide(input.body) +
    (backup && input.attachments.length ? `\n\n(The backup file, ${input.attachments.map((a) => a.filename).join(", ")}, is not kept here.)` : "") +
    (catalog && input.attachments.length ? `\n\n(The catalog file, ${input.attachments.map((a) => a.filename).join(", ")}, was attached. It is the same catalog in every catalog email, so it is not kept again here.)` : "");
  const [row] = await db
    .insert(schema.inboxReplies)
    .values({ emailId: null, toAddress: input.to, subject: hide(input.subject), body, sent: input.sent, error: input.sent ? null : (input.error ?? "not sent"), userId: null, kind: backup ? "auto" : (input.kind ?? "auto") })
    .returning();
  for (const a of files) {
    const data = Buffer.from(a.content, "base64");
    const name = a.filename.toLowerCase();
    const type = name.endsWith(".pdf") ? "application/pdf" : name.endsWith(".png") ? "image/png" : /\.jpe?g$/.test(name) ? "image/jpeg" : "application/octet-stream";
    const f = await storeFile({ fileName: a.filename, contentType: type, data });
    await db.update(schema.inboxFiles).set({ replyId: row.id }).where(eq(schema.inboxFiles.id, f.id));
  }
  return row;
}

/**
 * Schedule send (Abraham, Nov 19, 2026): once an hour (the free scheduler; Neon free plan, Nov 26, 2026), scheduled emails whose time
 * has come are sent with their files and the catalog. One that cannot be sent goes back to Drafts with the reason.
 */
export async function sendScheduledEmails(now = new Date()) {
  const d = schema.inboxDrafts;
  // Extra check G2 (Nov 27, 2026): nothing goes out on Shabbes or Yom Tov (Admin's calendar settings, like the phone);
  // emails due then keep their time and go out on the first run after
  const { bookingLock } = await import("@/lib/jewish-calendar");
  const { getSettings } = await import("@/lib/settings");
  if (bookingLock(now, (await getSettings()) as never).locked) return { due: 0, sent: 0, waiting: "Shabbes or Yom Tov" };
  const due = await db.select().from(d).where(and(isNull(d.discardedAt), isNull(d.sentReplyId), sql`${d.sendAt} IS NOT NULL AND ${d.sendAt} <= ${now}`));
  let sent = 0;
  for (const x of due) {
    // Deep check 17 (Nov 27, 2026): two runs at once could both send it. The draft is claimed first in one step (its
    // send time taken off, only if still unsent and still at that time); a run that loses the claim skips it.
    const [claimed] = await db
      .update(d)
      .set({ sendAt: null, sendError: "Sending now (if this stays, it may not have been sent: check Sent)" })
      .where(and(eq(d.id, x.id), isNull(d.sentReplyId), isNull(d.discardedAt), sql`${d.sendAt} = ${x.sendAt}`))
      .returning({ id: d.id });
    if (!claimed) continue;
    try {
      const r = await sendNewEmail({ to: x.toAddress, subject: x.subject, body: x.body, fileIds: x.fileIds ?? [], userId: x.userId, forwardOf: x.forwardOfEmailId, attachCatalog: x.attachCatalog, bodyHtml: x.bodyHtml });
      if (r.sent) {
        await db.update(d).set({ sentReplyId: r.id, sendError: null, sendAt: x.sendAt }).where(eq(d.id, x.id));
        sent++;
      } else await db.update(d).set({ sendAt: null, sendError: r.error ?? "not sent" }).where(eq(d.id, x.id));
    } catch (e) {
      await db.update(d).set({ sendAt: null, sendError: (e as Error).message }).where(eq(d.id, x.id));
    }
  }
  return { due: due.length, sent };
}

/** Formatted text from Compose, with the download-link lines for large files added under it. */
function htmlWithLinks(html: string | null | undefined, linkText: string): string | null {
  if (!html?.trim()) return null;
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return linkText.trim() ? `${html}<br><br>${esc(linkText.trim()).replace(/\n/g, "<br>")}` : html;
}
