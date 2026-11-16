"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireOwner } from "@/lib/auth";
import { sendMessage } from "@/lib/sms";
import { toE164 } from "@/lib/phone";
import { MMS_MAX_FILES, MMS_MAX_TOTAL_BYTES, bookingFor, checkOutgoingFiles, linkFilesToMessage, saveMessageFile } from "@/lib/message-files";
import { messageFileLink } from "@/lib/signed-link";

/** One upload to the site can be about 4.5 MB (Vercel), so each file goes up on its own, up to 4 MB. */
const ONE_FILE_MAX = 4 * 1024 * 1024;

/**
 * Attach a file to a text (Abraham, Nov 16, 2026; Owner only, like free-form replies). Saved privately in R2 first; it
 * goes out only with the text, and is linked to the message, the customer and their booking.
 */
export async function uploadTextFileAction(form: FormData): Promise<{ ok: true; id: number; size: number } | { ok: false; error: string }> {
  const s = await requireOwner();
  const phone = toE164(String(form.get("phone") || ""));
  const file = form.get("file") as File | null;
  if (!phone) return { ok: false, error: "Enter a valid US or Canada mobile number." };
  if (!file || typeof file === "string") return { ok: false, error: "Choose a file first." };
  const data = new Uint8Array(await file.arrayBuffer());
  if (data.length > ONE_FILE_MAX) return { ok: false, error: `"${file.name}" is ${(data.length / 1024 / 1024).toFixed(1)} MB. Each file can be up to 4 MB.` };
  const check = checkOutgoingFiles([{ name: file.name, data }]);
  if (!check.ok) return { ok: false, error: check.error };
  const [c] = await db.select({ id: schema.customers.id }).from(schema.customers).where(eq(schema.customers.phone, phone)).limit(1);
  try {
    const row = await saveMessageFile({ data, contentType: check.kinds[0], fileName: file.name, direction: "out", contactPhone: phone, customerId: c?.id ?? null, orderId: await bookingFor(c?.id), userId: s.userId });
    return { ok: true, id: row.id, size: row.sizeBytes };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Free-form text reply (Owner only, per the roles plan; Secretary and Delivery use approved templates), with any files
 * already uploaded. Goes through sendMessage, so STOP, consent, the test window and card-number rules all apply and the
 * message is logged. With files it's a picture text (MMS); without, a plain text (SMS).
 */
export async function sendReplyAction(_prev: { ok?: boolean; error?: string } | null, form: FormData): Promise<{ ok?: boolean; error?: string }> {
  const s = await requireOwner();
  const phone = toE164(String(form.get("phone") || ""));
  const body = String(form.get("body") || "").trim();
  const fileIds = String(form.get("fileIds") || "")
    .split(",")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  if (!phone) return { error: "Enter a valid US or Canada mobile number." };
  if (!body && !fileIds.length) return { error: "Type a message or attach a file first." };
  if (body.length > 1000) return { error: "Keep it under 1,000 characters." };
  if (fileIds.length > MMS_MAX_FILES) return { error: `You can attach up to ${MMS_MAX_FILES} files to one text.` };
  // Only this Owner's own unsent files for this number
  const files = fileIds.length
    ? await db
        .select()
        .from(schema.messageFiles)
        .where(and(inArray(schema.messageFiles.id, fileIds), eq(schema.messageFiles.contactPhone, phone), eq(schema.messageFiles.direction, "out"), isNull(schema.messageFiles.messageId)))
    : [];
  if (files.length !== fileIds.length) return { error: "A file could not be found. Remove it and attach it again." };
  const total = files.reduce((t, f) => t + f.sizeBytes, 0);
  if (total > MMS_MAX_TOTAL_BYTES) return { error: `These files are ${(total / 1024 / 1024).toFixed(1)} MB together. One text can carry 5 MB in all: remove a file or send it in another text.` };
  const [c] = await db.select({ id: schema.customers.id }).from(schema.customers).where(eq(schema.customers.phone, phone)).limit(1);
  const r = await sendMessage({ to: phone, body, mediaUrls: files.map((f) => messageFileLink(f.id)), kind: "transactional", event: "staff_reply", userId: s.userId, customerId: c?.id ?? null, orderId: files[0]?.orderId ?? null });
  // Every file stays with the message in the history, sent or not
  if (r.messageId) await linkFilesToMessage(files.map((f) => f.id), r.messageId);
  revalidatePath("/admin/messages");
  if (!r.sent) return { error: r.error || "Not sent." };
  if (r.mmsFallback) return { error: "The files could not go out as a picture text, so only the words were sent." };
  return { ok: true };
}
