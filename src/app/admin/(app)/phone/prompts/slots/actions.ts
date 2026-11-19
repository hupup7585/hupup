"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { saveSetting } from "@/lib/settings";
import { confirmSlot, markRecorded, slotsWithStatus, unconfirmSlot } from "@/lib/slot-status";

type R = { ok: boolean; message: string };
const done = (message: string): R => (revalidatePath("/admin/phone/prompts/slots"), { ok: true, message });

/** Abraham confirms the exact text of a slot (every comma, period and exclamation mark). Owner only. Audited. */
export async function confirmSlotAction(key: string): Promise<R> {
  const s = await requireOwner();
  try {
    await confirmSlot(key, s.userId);
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  await db.insert(schema.auditLog).values({ userId: s.userId, action: "recording_slot.confirmed", entityType: "recording_slot", entityId: key });
  return done("Confirmed. Hark can record this exact text now.");
}

/** Undo a confirm made by mistake (Abraham, Nov 19, 2026). Owner only. Audited. */
export async function unconfirmSlotAction(key: string): Promise<R> {
  const s = await requireOwner();
  await unconfirmSlot(key);
  await db.insert(schema.auditLog).values({ userId: s.userId, action: "recording_slot.unconfirmed", entityType: "recording_slot", entityId: key });
  return done("Confirm undone. This text is waiting for Abraham again.");
}

export async function markRecordedAction(key: string): Promise<R> {
  const s = await requireOwner();
  try {
    await markRecorded(key, s.userId);
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  return done("Marked recorded. Upload it when ready.");
}

/** The final switch: Achird for the whole line. Only when every slot is uploaded. Owner only, default off. */
export async function achirdSwitchAction(on: boolean): Promise<R> {
  const s = await requireOwner();
  if (on) {
    const missing = (await slotsWithStatus()).filter((x) => x.status !== "uploaded").length;
    if (missing) return { ok: false, message: `${missing} recording slots are not uploaded yet. Achird for the whole line can be turned on when every slot is uploaded.` };
  }
  await saveSetting("achirdWholeLine", on, s.userId);
  await db.insert(schema.auditLog).values({ userId: s.userId, action: on ? "voice.achird_whole_line_on" : "voice.achird_whole_line_off", entityType: "settings", entityId: "achirdWholeLine" });
  return done(on ? "Achird for the whole line is on." : "Achird for the whole line is off. Lines without a recording use Puck.");
}

/** Option B: Google speaks the changing parts in Achird. Owner only, default off. It costs money once on. */
export async function googleLiveSwitchAction(on: boolean): Promise<R> {
  const s = await requireOwner();
  if (on && !process.env.GOOGLE_TTS_API_KEY) return { ok: false, message: "GOOGLE_TTS_API_KEY is not in Vercel, so this can't be turned on yet." };
  await saveSetting("googleLiveVoice", on, s.userId);
  await db.insert(schema.auditLog).values({ userId: s.userId, action: on ? "voice.google_live_on" : "voice.google_live_off", entityType: "settings", entityId: "googleLiveVoice" });
  return done(on ? "Google Achird for the changing parts is on." : "Google Achird for the changing parts is off.");
}
