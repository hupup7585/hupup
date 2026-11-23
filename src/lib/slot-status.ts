import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { allSlots, type Slot } from "@/lib/recording-slots";
import { customSlots } from "@/lib/custom-slots";

/**
 * Recording slot status (Abraham, Nov 15, 2026):
 *   Waiting for Abraham -> Confirmed (he confirmed this exact text) -> Recorded (Hark marked it recorded)
 *   -> Uploaded (a recording of it is uploaded). A text that changes after confirming goes back to Waiting.
 * Nothing can be uploaded for a slot until its exact text is Confirmed.
 */
export type SlotStatus = "waiting" | "confirmed" | "recorded" | "uploaded";
export const STATUS_WORDS: Record<SlotStatus, string> = { waiting: "Waiting for Abraham", confirmed: "Confirmed", recorded: "Recorded", uploaded: "Uploaded" };

export async function catalogItems() {
  return (await db.select({ id: schema.products.id, name: schema.products.name, active: schema.products.active }).from(schema.products).orderBy(asc(schema.products.id)))
    .filter((p) => p.active)
    .map((p) => ({ id: p.id, name: (p.name || "").trim() }))
    .filter((p) => p.name);
}

/** The Admin text of each edited line (Hotline prompts), so the list shows what plays. */
async function editedTexts(): Promise<Record<string, string | null>> {
  return Object.fromEntries((await db.select({ key: schema.voicePrompts.key, text: schema.voicePrompts.text }).from(schema.voicePrompts)).map((r) => [r.key, r.text]));
}

export async function slotsWithStatus(): Promise<(Slot & { status: SlotStatus; uploads: number; playing: boolean; liveRecordingId: number | null })[]> {
  const slots = allSlots(await catalogItems(), await editedTexts(), await customSlots());
  const rows = new Map((await db.select().from(schema.recordingSlots)).map((r) => [r.key, r]));
  const recs = await db.select({ key: schema.promptRecordings.promptKey, source: schema.promptRecordings.source, complete: schema.promptRecordings.complete }).from(schema.promptRecordings);
  const liveRec = new Map((await db.select({ key: schema.voicePrompts.key, rec: schema.voicePrompts.recordingId }).from(schema.voicePrompts)).filter((v) => v.rec).map((v) => [v.key, v.rec!]));
  return slots.map((s) => {
    const r = rows.get(s.key);
    const confirmed = Boolean(r?.confirmedText && r.confirmedText === s.text);
    const uploads = recs.filter((x) => x.key === s.key && x.complete && x.source === "upload").length;
    const status: SlotStatus = !confirmed ? "waiting" : uploads ? "uploaded" : r?.recordedAt ? "recorded" : "confirmed";
    return { ...s, status, uploads, playing: liveRec.has(s.key), liveRecordingId: liveRec.get(s.key) ?? null };
  });
}

export async function findSlot(key: string): Promise<Slot | null> {
  return allSlots(await catalogItems(), await editedTexts(), await customSlots()).find((s) => s.key === key) ?? null;
}

/** Abraham confirms the exact text (with every comma, period and exclamation mark). Owner only (checked by the caller). */
export async function confirmSlot(key: string, userId: number | null) {
  const s = await findSlot(key);
  if (!s) throw new Error("That recording slot doesn't exist.");
  await db
    .insert(schema.recordingSlots)
    .values({ key, confirmedText: s.text, confirmedAt: new Date(), confirmedBy: userId, recordedAt: null })
    .onConflictDoUpdate({ target: schema.recordingSlots.key, set: { confirmedText: s.text, confirmedAt: new Date(), confirmedBy: userId, recordedAt: null } });
}

/** Undo a confirm made by mistake: the slot goes back to Waiting for Abraham. Owner only (checked by the caller). */
export async function unconfirmSlot(key: string) {
  await db.delete(schema.recordingSlots).where(eq(schema.recordingSlots.key, key));
}

export async function markRecorded(key: string, userId: number | null) {
  if (!(await isConfirmed(key))) throw new Error("Record a line only after Abraham confirms its exact text.");
  await db.update(schema.recordingSlots).set({ recordedAt: new Date(), recordedBy: userId }).where(eq(schema.recordingSlots.key, key));
}

export async function isConfirmed(key: string): Promise<boolean> {
  const s = await findSlot(key);
  if (!s) return false;
  const [r] = await db.select().from(schema.recordingSlots).where(eq(schema.recordingSlots.key, key)).limit(1);
  return Boolean(r?.confirmedText && r.confirmedText === s.text);
}
