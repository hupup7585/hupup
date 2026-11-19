"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { repliesActive, saveReplyFileChunk, sendNewEmail, sendReply, setRead, startReplyFile } from "@/lib/inbox";
import { BULK_ACTIONS, bulkEmails, createLabel, discardDraft, draftSent, editLabel, removeLabel, saveDraft, scheduleDraft, snoozeOptions, unscheduleDraft, type BulkAction } from "@/lib/inbox-folders";
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

export async function sendReplyAction(emailId: number, body: string, fileIds: number[], draftId?: number | null, bodyHtml?: string | null): Promise<R> {
  const s = await requireOwner();
  if (!repliesActive()) return { ok: false, message: "Not active yet: replies go out from info@ once the sender is set up." };
  try {
    const r = await sendReply({ emailId, body, fileIds, userId: s.userId, bodyHtml: bodyHtml ?? null });
    if (draftId && r.sent) await draftSent(draftId, r.id);
    await db.insert(schema.auditLog).values({ userId: s.userId, action: r.sent ? "inbox.reply_sent" : "inbox.reply_failed", entityType: "inbox_email", entityId: String(emailId), after: { to: r.toAddress, subject: r.subject, files: fileIds.length } });
    revalidatePath(`/admin/inbox/${emailId}`);
    return r.sent ? { ok: true, message: "Reply sent from info@hupupattractions.com." } : { ok: false, message: `Not sent: ${r.error}. The reply is saved below.` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** Owner: a new email from info@ (not a reply), with attachments. */
export async function sendNewEmailAction(to: string, subject: string, body: string, fileIds: number[], draftId?: number | null, forwardOf?: number | null, attachCatalog?: boolean, bodyHtml?: string | null): Promise<R> {
  const s = await requireOwner();
  if (!repliesActive()) return { ok: false, message: "Not active yet: email goes out from info@ once the sender is set up." };
  try {
    const r = await sendNewEmail({ to, subject, body, fileIds, userId: s.userId, forwardOf: forwardOf ?? null, attachCatalog: Boolean(attachCatalog), bodyHtml: bodyHtml ?? null });
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
  // Snooze: a preset (later today, tomorrow, weekend, next week) or a date and time picked (Eastern)
  let until: Date | null = null;
  if (action === "snooze") {
    const pick = String(form.get("snooze") ?? "");
    const preset = snoozeOptions().find((x) => x.key === pick);
    until = preset ? preset.at : easternInput(String(form.get("snoozeAt") ?? ""));
  }
  if (action === ("markall" as BulkAction)) {
    const { markAllRead, isFolder } = await import("@/lib/inbox-folders");
    const f = String(form.get("folder") ?? "inbox");
    await markAllRead(isFolder(f) ? f : "inbox", String(form.get("labelFilter") ?? "") || undefined);
  } else if (BULK_ACTIONS.includes(action)) {
    try {
      await bulkEmails(ids, action, String(form.get("label") ?? ""), until);
    } catch {
      /* no label chosen, or a snooze time in the past: nothing changes */
    }
  }
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

/** A date and time typed in the Eastern time zone ("2026-11-20T09:30") to a moment; null when empty or not valid. */
function easternInput(v: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return null;
  const guess = new Date(`${v}:00Z`);
  const local = new Date(guess.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const utc = new Date(guess.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(guess.getTime() - (local.getTime() - utc.getTime()));
}

/** Manage labels: rename or change the color (every email keeps the label under its new name). */
export async function editLabelAction(form: FormData) {
  await requireOwner();
  try {
    await editLabel(String(form.get("old") ?? ""), String(form.get("name") ?? ""), String(form.get("color") ?? ""));
  } catch {
    /* empty name: nothing changes */
  }
  revalidatePath("/admin", "layout");
  redirect("/admin/inbox/labels");
}

/**
 * Schedule send (Gmail-style, Abraham, Nov 19, 2026): the email waits under Scheduled and the every-5-minutes job sends
 * it at its time, with its files and the catalog. `when` is a preset ("tomorrow-am", "tomorrow-pm", "monday-am") or a
 * date and time typed in Eastern time.
 */
export async function scheduleSendAction(input: { draftId?: number | null; to: string; subject: string; body: string; fileIds: number[]; attachCatalog: boolean; forwardOf?: number | null; when: string; bodyHtml?: string | null }): Promise<R> {
  const s = await requireOwner();
  if (!repliesActive()) return { ok: false, message: "Not active yet: email goes out from info@ once the sender is set up." };
  const to = input.to.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { ok: false, message: "Enter one email address to send to." };
  if (!input.subject.trim() || !input.body.trim()) return { ok: false, message: "Write a subject and your email first." };
  const sendAt = schedulePreset(input.when) ?? easternInput(input.when);
  if (!sendAt || sendAt.getTime() <= Date.now()) return { ok: false, message: "Choose a time in the future." };
  try {
    const id = await scheduleDraft({ id: input.draftId ?? null, to, subject: input.subject, body: input.body, fileIds: input.fileIds, attachCatalog: input.attachCatalog, forwardOf: input.forwardOf ?? null, sendAt, userId: s.userId, bodyHtml: input.bodyHtml ?? null });
    revalidatePath("/admin", "layout");
    return { ok: true, message: `Scheduled for ${sendAt.toLocaleString("en-US", { timeZone: "America/New_York", weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })}.`, id };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

function schedulePreset(key: string): Date | null {
  const opts = snoozeOptions();
  const tomorrow = opts.find((x) => x.key === "tomorrow")!.at; // tomorrow 8:00 AM Eastern
  if (key === "tomorrow-am") return tomorrow;
  if (key === "tomorrow-pm") return new Date(tomorrow.getTime() + 5 * 3600_000); // 1:00 PM
  if (key === "monday-am") return opts.find((x) => x.key === "nextweek")!.at;
  return null;
}

/** Cancel a scheduled send: back to Drafts. */
export async function unscheduleAction(form: FormData) {
  await requireOwner();
  await unscheduleDraft(Number(form.get("id")));
  revalidatePath("/admin", "layout");
  redirect("/admin/inbox?f=drafts");
}
