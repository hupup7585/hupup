"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { saveSetting } from "@/lib/settings";
import { confirmSlot, markRecorded, slotsWithStatus, unconfirmSlot } from "@/lib/slot-status";
import { addCustomSlot, addCustomSlots, deleteCustomSlot, renameCustomSlot } from "@/lib/custom-slots";

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
export async function googleLiveSwitchAction(on: boolean, confirm?: { code: string; typed: string }): Promise<R> {
  const s = await requireOwner();
  if (on && !process.env.GOOGLE_TTS_API_KEY) return { ok: false, message: "GOOGLE_TTS_API_KEY is not in Vercel, so this can't be turned on yet." };
  // Hark's review item 9: with the safety check on, turning it on needs a fresh code and the typed words
  const { getSettings } = await import("@/lib/settings");
  const { sensitiveRefusal } = await import("@/lib/switch-guard");
  const was = (await getSettings()).googleLiveVoice;
  const form = new Map<string, string>([["switchCode", confirm?.code ?? ""], ["switchTyped", confirm?.typed ?? ""]]);
  const refusal = await sensitiveRefusal(s.userId ?? null, "googleLiveVoice", on && !was, form);
  if (refusal) return { ok: false, message: `Not turned on. ${refusal}` };
  await saveSetting("googleLiveVoice", on, s.userId);
  await db.insert(schema.auditLog).values({ userId: s.userId, action: on ? "voice.google_live_on" : "voice.google_live_off", entityType: "settings", entityId: "googleLiveVoice" });
  return done(on ? "Google Achird for the changing parts is on." : "Google Achird for the changing parts is off.");
}

/** Add a new slot (Abraham, Nov 23, 2026). Audited. A duplicate lookup key warns and is not saved. */
export async function addSlotAction(form: FormData): Promise<R> {
  const s = await requireOwner();
  const existing = (await slotsWithStatus()).map((x) => ({ key: x.key, group: x.group }));
  const input = { name: String(form.get("name") || ""), group: String(form.get("group") || ""), text: String(form.get("text") || ""), lookup: String(form.get("lookup") || ""), plays: String(form.get("plays") || "") };
  const r = await addCustomSlot(input, existing, s.userId);
  if (!r.ok) return { ok: false, message: r.message };
  await db.insert(schema.auditLog).values({ userId: s.userId, action: "recording_slot.added", entityType: "recording_slot", entityId: r.key, after: input });
  return done("Saved");
}

/** Many slots from a CSV (name, group, exact text, key). Good rows are saved; problem rows are listed. */
export async function addSlotsCsvAction(form: FormData): Promise<R & { added?: number; problems?: { line: number; message: string }[] }> {
  const s = await requireOwner();
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) return { ok: false, message: "Choose the CSV file first." };
  const { parseCsv } = await import("@/lib/books");
  const all = parseCsv((await file.text()).replace(/^\uFEFF/, "")).filter((r) => r.some((c) => c.trim()));
  const head = (all[0] ?? []).map((c) => c.trim().toLowerCase());
  const body = head[0]?.includes("name") ? all.slice(1) : all;
  const rows = body.map(([name = "", group = "", text = "", lookup = "", plays = ""]) => ({ name, group, text, lookup, plays }));
  const existing = (await slotsWithStatus()).map((x) => ({ key: x.key, group: x.group }));
  const r = await addCustomSlots(rows, existing, s.userId);
  await db.insert(schema.auditLog).values({ userId: s.userId, action: "recording_slot.added_csv", entityType: "recording_slot", entityId: "csv", after: { added: r.added, problems: r.problems.length } });
  revalidatePath("/admin/phone/prompts/slots");
  return { ok: r.added > 0 || !r.problems.length, message: `Saved ${r.added} slots.${r.problems.length ? ` ${r.problems.length} rows were not saved.` : ""}`, added: r.added, problems: r.problems.slice(0, 50) };
}

export async function renameSlotAction(key: string, name: string): Promise<R> {
  const s = await requireOwner();
  const r = await renameCustomSlot(key, name, s.userId);
  if (!r.ok) return r;
  await db.insert(schema.auditLog).values({ userId: s.userId, action: "recording_slot.renamed", entityType: "recording_slot", entityId: key, after: { name } });
  return done("Saved");
}

/** Owner only, after the Are you sure check in the page. */
export async function deleteSlotAction(key: string): Promise<R> {
  const s = await requireOwner();
  if (s.role !== "owner") return { ok: false, message: "Only the Owner can delete a slot." };
  const r = await deleteCustomSlot(key, s.userId);
  if (!r.ok) return r;
  await db.insert(schema.auditLog).values({ userId: s.userId, action: "recording_slot.deleted", entityType: "recording_slot", entityId: key });
  return done("Deleted");
}
