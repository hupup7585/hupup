"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { requireOwner } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { PROMPTS, type PromptKey } from "@/lib/ivr/prompts";
import { approvePrompt, getRecording, makeGoogleRecording, saveRecordingChunk, startRecordingUpload, chooseGoogleVoice, chooseRecording } from "@/lib/prompt-recordings";

export async function savePromptAction(key: string, text: string): Promise<{ ok: boolean; message: string }> {
  await requireOwner();
  if (!(key in PROMPTS)) return { ok: false, message: "Unknown prompt" };
  const clean = text.trim();
  if (/<[^>]+>/.test(clean)) return { ok: false, message: "Plain text only: the hotline voice doesn't support tags or SSML." };
  if (clean.length > 600) return { ok: false, message: "Please keep prompts under 600 characters." };
  const def = PROMPTS[key as PromptKey] as { vars?: string[] };
  const missing = (def.vars ?? []).filter((v) => !clean.includes(`{${v}}`));
  if (clean && missing.length) return { ok: false, message: `Keep these placeholders in the text: ${missing.map((m) => `{${m}}`).join(", ")}` };
  if (!clean) {
    // Back to the default wording; the line's recordings and approval stay (Abraham: never delete recordings)
    await db.update(schema.voicePrompts).set({ text: null, updatedAt: new Date() }).where(eq(schema.voicePrompts.key, key));
  } else {
    await db
      .insert(schema.voicePrompts)
      .values({ key, text: clean })
      .onConflictDoUpdate({ target: schema.voicePrompts.key, set: { text: clean, updatedAt: new Date() } });
  }
  revalidatePath("/admin/phone/prompts");
  return { ok: true, message: clean ? "Saved — callers hear this right away." : "Reset to the default wording." };
}

type R = { ok: boolean; message: string };

async function log(userId: number | null, action: string, key: string, after: Record<string, unknown>) {
  await db.insert(schema.auditLog).values({ userId, action, entityType: "voice_prompt", entityId: key, after });
}

/** Upload recording (Abraham, Phone Recordings): open an upload, then send the file in pieces. */
export async function startRecordingAction(key: string, fileName: string, size: number): Promise<R & { id?: number }> {
  const s = await requireOwner();
  try {
    const r = await startRecordingUpload(key, fileName, size, s.userId);
    return { ok: true, message: "", id: r.id };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function recordingChunkAction(form: FormData): Promise<R> {
  const s = await requireOwner();
  try {
    const id = Number(form.get("id"));
    const idx = Number(form.get("idx"));
    const last = form.get("last") === "1";
    const file = form.get("data") as Blob | null;
    if (!file) return { ok: false, message: "That piece of the file didn't arrive." };
    const r = await saveRecordingChunk(id, idx, Buffer.from(await file.arrayBuffer()), last, s.userId);
    if (r.complete) {
      const rec = await getRecording(id);
      await log(s.userId, "voice_prompt.recording_uploaded", rec?.promptKey ?? "", { recordingId: id, fileName: rec?.fileName, sizeBytes: rec?.sizeBytes });
      revalidatePath("/admin/phone/prompts");
      return { ok: true, message: "Uploaded. Callers hear your recording on this line right away." };
    }
    return { ok: true, message: "" };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function selectRecordingAction(key: string, id: number): Promise<R> {
  const s = await requireOwner();
  try {
    await chooseRecording(key, id, s.userId);
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  await log(s.userId, "voice_prompt.recording_used", key, { recordingId: id });
  revalidatePath("/admin/phone/prompts");
  return { ok: true, message: "Callers hear this recording now." };
}

export async function googleVoiceAction(key: string): Promise<R> {
  const s = await requireOwner();
  await chooseGoogleVoice(key, s.userId);
  await log(s.userId, "voice_prompt.google_voice", key, {});
  revalidatePath("/admin/phone/prompts");
  return { ok: true, message: "Back to the Google voice. Your recordings are kept below." };
}

export async function makeGoogleRecordingAction(key: string, wording: string): Promise<R> {
  const s = await requireOwner();
  try {
    const r = await makeGoogleRecording(key, wording, s.userId);
    if (!r) return { ok: false, message: "Not active yet: Google Text-to-Speech needs a Google Cloud billing account and key." };
    await log(s.userId, "voice_prompt.google_recording", key, { recordingId: r.id });
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  revalidatePath("/admin/phone/prompts");
  return { ok: true, message: "Google voice recording saved." };
}

export async function approvePromptAction(key: string): Promise<R> {
  const s = await requireOwner();
  if (!(key in PROMPTS)) return { ok: false, message: "Unknown prompt" };
  await approvePrompt(key, s.userId);
  await log(s.userId, "voice_prompt.approved", key, { wording: PROMPTS[key as PromptKey].text });
  revalidatePath("/admin/phone/prompts");
  return { ok: true, message: "Approved. This line plays on the phone now." };
}

/** Voice samples (listening only; never changes IVR_VOICE or a live line). */
export async function makeVoiceSamplesAction(): Promise<R> {
  const s = await requireOwner();
  const { makeVoiceSamples } = await import("@/lib/voice-samples");
  try {
    const made = await makeVoiceSamples(s.userId);
    if (made === null) return { ok: false, message: "Not active yet: Google Text-to-Speech needs a Google Cloud billing account and key (GOOGLE_TTS_API_KEY)." };
    await log(s.userId, "voice_samples.made", "voice-samples", { made });
    revalidatePath("/admin/phone/prompts");
    return { ok: true, message: made ? `Made ${made} voice sample${made > 1 ? "s" : ""}.` : "All samples are already made." };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
