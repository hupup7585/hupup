"use server";

import { saveSetting } from "@/lib/settings";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireOwner, requireStaff } from "@/lib/auth";
import { deleteVoicemail, purgeVoicemail, restoreVoicemail } from "@/lib/voicemail";
import { toE164 } from "@/lib/phone";
import { setVmPin, validPin } from "@/lib/vm-access";
import { redirect } from "next/navigation";
import { msgQuery } from "@/lib/url-message";

async function audit(userId: number | null, action: string, entityId: number, after: Record<string, unknown> = {}) {
  await db.insert(schema.auditLog).values({ userId, action, entityType: "voicemail", entityId: String(entityId), after });
}

export async function setHeardAction(id: number, heard: boolean) {
  const s = await requireStaff(["owner", "secretary"]);
  await db.update(schema.voicemails).set({ heardAt: heard ? new Date() : null, heardBy: heard ? s.userId : null }).where(eq(schema.voicemails.id, id));
  await audit(s.userId, heard ? "voicemail.heard" : "voicemail.unheard", id);
  revalidatePath("/admin/voicemail");
}

export async function setUrgentAction(id: number, urgent: boolean) {
  const s = await requireStaff(["owner", "secretary"]);
  await db.update(schema.voicemails).set({ urgent }).where(eq(schema.voicemails.id, id));
  await audit(s.userId, "voicemail.urgent", id, { urgent });
  revalidatePath("/admin/voicemail");
}

export async function deleteVoicemailAction(id: number) {
  const s = await requireStaff(["owner", "secretary"]);
  await deleteVoicemail(id);
  await audit(s.userId, "voicemail.hidden", id);
  revalidatePath("/admin/voicemail");
}

/** Owner: show a hidden message again. */
export async function restoreVoicemailAction(id: number) {
  const s = await requireOwner();
  await restoreVoicemail(id);
  await audit(s.userId, "voicemail.restored", id);
  revalidatePath("/admin/voicemail");
}

/** Owner only, after the confirm step: remove the recording for good. */
export async function purgeVoicemailAction(id: number) {
  const s = await requireOwner();
  const ok = await purgeVoicemail(id);
  await audit(s.userId, ok ? "voicemail.deleted_for_good" : "voicemail.delete_for_good_failed", id);
  revalidatePath("/admin/voicemail");
}

/** Box settings (Owner): greeting, transcription, length, who gets alerted. */
export async function saveBoxAction(form: FormData) {
  const s = await requireOwner();
  const id = Number(form.get("id"));
  const list = (k: string) => String(form.get(k) || "").split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);
  const phones = list("notifySms").map((p) => toE164(p)).filter((p): p is string => Boolean(p));
  const emails = list("notifyEmail").filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
  const after = {
    greetingText: String(form.get("greetingText") || "").trim().slice(0, 600) || null,
    transcribe: form.get("transcribe") === "on",
    enabled: form.get("enabled") === "on",
    maxLengthSec: Math.min(600, Math.max(10, Number(form.get("maxLengthSec")) || 120)),
    notifySms: phones,
    notifyEmail: emails,
  };
  await db.update(schema.voicemailBoxes).set(after).where(eq(schema.voicemailBoxes.id, id));
  await saveSetting("voicemailMms", form.get("voicemailMms") === "on", s.userId);
  await saveSetting("missedCallAlerts", form.get("missedCallAlerts") === "on", s.userId);
  await saveSetting("incomingTextEmail", form.get("incomingTextEmail") === "on", s.userId);
  await db.insert(schema.auditLog).values({ userId: s.userId, action: "voicemail_box.updated", entityType: "voicemail_box", entityId: String(id), after });
  revalidatePath("/admin/voicemail");
}

/** Owner: set or change the voicemail PIN for staff access by phone (stored hashed only). */
export async function setVmPinAction(form: FormData) {
  const s = await requireOwner();
  const pin = String(form.get("pin") || "").trim();
  const again = String(form.get("pinAgain") || "").trim();
  if (!validPin(pin) || pin !== again) {
    revalidatePath("/admin/voicemail");
    return;
  }
  await setVmPin(pin, s.userId);
  await audit(s.userId, "voicemail.pin_changed", 0); // the PIN itself is never logged
  revalidatePath("/admin/voicemail");
}

/**
 * Deep check 0600 M63 (Nov 27, 2026): Owner sets or resets a personal box password in Admin (a forgotten password,
 * or replacing the default 1234). Only the bcrypt hash is stored; it also clears wrong tries and any lock. Audited,
 * never with the password itself.
 */
export async function setBoxPinAction(form: FormData) {
  const s = await requireOwner();
  const back = (m: string) => redirect(`/admin/voicemail?${msgQuery(m)}#vm-box-passwords`);
  const boxId = Number(form.get("boxId"));
  const pin = String(form.get("pin") ?? "").trim();
  const again = String(form.get("pinAgain") ?? "").trim();
  const { getBox, setBoxPin } = await import("@/lib/vm-boxes");
  const box = Number.isSafeInteger(boxId) && boxId > 0 ? await getBox(boxId) : null;
  if (!box || !box.ownerUserId) return back("Not saved: choose a box.");
  if (!validPin(pin)) return back("Not saved: a password is 4 to 8 digits.");
  if (pin !== again) return back("Not saved: the two passwords are not the same.");
  await setBoxPin(box.id, pin);
  await db.insert(schema.auditLog).values({ userId: s.userId, action: "voicemail_box.password_set", entityType: "voicemail_box", entityId: String(box.id), after: { box: box.boxNumber } });
  revalidatePath("/admin/voicemail");
  return back(`Saved: the password for ${box.name}'s box (${box.boxNumber}) is changed, and the box is unlocked.`);
}
