"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { repliesActive, saveReplyFileChunk, sendNewEmail, sendReply, setRead, startReplyFile } from "@/lib/inbox";

type R = { ok: boolean; message: string; id?: number };

export async function setReadAction(id: number, read: boolean): Promise<R> {
  await requireOwner();
  await setRead(id, read);
  revalidatePath("/admin", "layout");
  return { ok: true, message: read ? "Marked read" : "Marked unread" };
}

export async function startReplyFileAction(name: string, type: string, size: number): Promise<R> {
  const s = await requireOwner();
  try {
    const f = await startReplyFile(name, type, size, s.userId);
    return { ok: true, message: "", id: f.id };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function replyFileChunkAction(form: FormData): Promise<R> {
  await requireOwner();
  try {
    const blob = form.get("data") as Blob | null;
    if (!blob) return { ok: false, message: "That piece of the file didn't arrive." };
    await saveReplyFileChunk(Number(form.get("id")), Number(form.get("idx")), Buffer.from(await blob.arrayBuffer()), form.get("last") === "1");
    return { ok: true, message: "" };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function sendReplyAction(emailId: number, body: string, fileIds: number[]): Promise<R> {
  const s = await requireOwner();
  if (!repliesActive()) return { ok: false, message: "Not active yet: replies go out from info@ once the sender is set up." };
  try {
    const r = await sendReply({ emailId, body, fileIds, userId: s.userId });
    await db.insert(schema.auditLog).values({ userId: s.userId, action: r.sent ? "inbox.reply_sent" : "inbox.reply_failed", entityType: "inbox_email", entityId: String(emailId), after: { to: r.toAddress, subject: r.subject, files: fileIds.length } });
    revalidatePath(`/admin/inbox/${emailId}`);
    return r.sent ? { ok: true, message: "Reply sent from info@hupupattractions.com." } : { ok: false, message: `Not sent: ${r.error}. The reply is saved below.` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** Owner: a new email from info@ (not a reply), with attachments. */
export async function sendNewEmailAction(to: string, subject: string, body: string, fileIds: number[]): Promise<R> {
  const s = await requireOwner();
  if (!repliesActive()) return { ok: false, message: "Not active yet: email goes out from info@ once the sender is set up." };
  try {
    const r = await sendNewEmail({ to, subject, body, fileIds, userId: s.userId });
    await db.insert(schema.auditLog).values({ userId: s.userId, action: r.sent ? "inbox.new_email_sent" : "inbox.new_email_failed", entityType: "inbox_reply", entityId: String(r.id), after: { to: r.toAddress, subject: r.subject, files: fileIds.length } });
    revalidatePath("/admin/inbox");
    return r.sent ? { ok: true, message: `Sent to ${r.toAddress} from info@hupupattractions.com.` } : { ok: false, message: `Not sent: ${r.error}. It's saved under Sent emails.` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
