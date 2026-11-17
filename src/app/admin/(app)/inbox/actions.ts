"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { repliesActive, saveReplyFileChunk, sendNewEmail, sendReply, setRead, startReplyFile } from "@/lib/inbox";
import { BULK_ACTIONS, bulkEmails, createLabel, discardDraft, draftSent, removeLabel, saveDraft, type BulkAction } from "@/lib/inbox-folders";
import { redirect } from "next/navigation";

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

export async function sendReplyAction(emailId: number, body: string, fileIds: number[], draftId?: number | null): Promise<R> {
  const s = await requireOwner();
  if (!repliesActive()) return { ok: false, message: "Not active yet: replies go out from info@ once the sender is set up." };
  try {
    const r = await sendReply({ emailId, body, fileIds, userId: s.userId });
    if (draftId && r.sent) await draftSent(draftId, r.id);
    await db.insert(schema.auditLog).values({ userId: s.userId, action: r.sent ? "inbox.reply_sent" : "inbox.reply_failed", entityType: "inbox_email", entityId: String(emailId), after: { to: r.toAddress, subject: r.subject, files: fileIds.length } });
    revalidatePath(`/admin/inbox/${emailId}`);
    return r.sent ? { ok: true, message: "Reply sent from info@hupupattractions.com." } : { ok: false, message: `Not sent: ${r.error}. The reply is saved below.` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** Owner: a new email from info@ (not a reply), with attachments. */
export async function sendNewEmailAction(to: string, subject: string, body: string, fileIds: number[], draftId?: number | null, forwardOf?: number | null, attachCatalog?: boolean): Promise<R> {
  const s = await requireOwner();
  if (!repliesActive()) return { ok: false, message: "Not active yet: email goes out from info@ once the sender is set up." };
  try {
    const r = await sendNewEmail({ to, subject, body, fileIds, userId: s.userId, forwardOf: forwardOf ?? null, attachCatalog: Boolean(attachCatalog) });
    if (draftId && r.sent) await draftSent(draftId, r.id);
    await db.insert(schema.auditLog).values({ userId: s.userId, action: r.sent ? "inbox.new_email_sent" : "inbox.new_email_failed", entityType: "inbox_reply", entityId: String(r.id), after: { to: r.toAddress, subject: r.subject, files: fileIds.length, catalog: Boolean(attachCatalog) } });
    revalidatePath("/admin/inbox");
    return r.sent ? { ok: true, message: `Sent to ${r.toAddress} from info@hupupattractions.com.` } : { ok: false, message: `Not sent: ${r.error}. It's saved under Sent emails.` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/* ---- Gmail-style Inbox (Abraham, Nov 15, 2026) ---- */

/** The check boxes and the toolbar: one action on every chosen email. Comes back to the same folder. */
export async function bulkAction(form: FormData) {
  await requireOwner();
  const action = String(form.get("action") ?? "") as BulkAction;
  const ids = form.getAll("id").map(Number);
  const back = String(form.get("back") || "/admin/inbox");
  if (BULK_ACTIONS.includes(action)) await bulkEmails(ids, action, String(form.get("label") ?? ""));
  revalidatePath("/admin", "layout");
  redirect(back.startsWith("/admin/inbox") ? back : "/admin/inbox");
}

export async function createLabelAction(form: FormData) {
  await requireOwner();
  try {
    await createLabel(String(form.get("name") ?? ""), String(form.get("color") ?? ""));
  } catch {
    /* empty name: nothing to add */
  }
  revalidatePath("/admin/inbox");
  redirect("/admin/inbox");
}

export async function removeLabelAction(form: FormData) {
  await requireOwner();
  await removeLabel(String(form.get("name") ?? ""));
  revalidatePath("/admin/inbox");
  redirect("/admin/inbox");
}

export async function saveDraftAction(input: { id?: number | null; to: string; subject: string; body: string; replyTo?: number | null; forwardOf?: number | null }): Promise<R> {
  const s = await requireOwner();
  const id = await saveDraft({ ...input, userId: s.userId });
  return { ok: true, message: "Draft saved", id };
}

export async function discardDraftAction(id: number): Promise<R> {
  await requireOwner();
  await discardDraft(id);
  revalidatePath("/admin/inbox");
  return { ok: true, message: "Draft discarded" };
}

/** The star on one email (list or reading view). */
export async function toggleStarAction(id: number, on: boolean): Promise<R> {
  await requireOwner();
  await bulkEmails([id], on ? "star" : "unstar");
  revalidatePath("/admin/inbox");
  return { ok: true, message: on ? "Starred" : "Star removed" };
}

/** One click on a row (Abraham, Nov 16, 2026): Trash, or Restore from Trash. Trash only hides the email. */
export async function trashOneAction(id: number, restore = false) {
  await requireOwner();
  await bulkEmails([id], restore ? "restore" : "trash");
  revalidatePath("/admin", "layout");
}

/** Discard a draft from the Drafts list (it stops showing; nothing was sent). */
export async function discardDraftRowAction(id: number) {
  await requireOwner();
  const { discardDraft } = await import("@/lib/inbox-folders");
  await discardDraft(id);
  revalidatePath("/admin", "layout");
}
