"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { requireOwner } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { PROMPTS, type PromptKey } from "@/lib/ivr/prompts";
import { PromptError, approveDraft, discardDraft, restoreVersion, saveDraft } from "@/lib/prompt-versions";
import { approvePrompt, getRecording, makeGoogleRecording, saveRecordingChunk, startRecordingUpload, chooseGoogleVoice, chooseRecording } from "@/lib/prompt-recordings";

/** Edit (Abraham, Nov 13, 2026): saves a new draft "Waiting for approval"; the live wording keeps playing. */
export async function savePromptAction(key: string, text: string): Promise<{ ok: boolean; message: string }> {
  const s = await requireOwner();
  try {
    await saveDraft(key, text, s.userId);
  } catch (e) {
    return { ok: false, message: e instanceof PromptError ? e.message : "Something went wrong. Nothing was saved." };
  }
  revalidatePath("/admin/phone/prompts");
  return { ok: true, message: "Saved as a draft, waiting for approval. The live line keeps playing until you approve it." };
}

export async function approveDraftAction(versionId: number): Promise<{ ok: boolean; message: string }> {
  const s = await requireOwner();
  try {
    const r = await approveDraft(versionId, s.userId);
    revalidatePath("/admin/phone/prompts");
    return { ok: true, message: r.recorded ? "Approved and live, with a new Google voice recording." : "Approved and live now (live Google voice)." };
  } catch (e) {
    return { ok: false, message: e instanceof PromptError ? e.message : "Something went wrong. Nothing changed." };
  }
}

export async function discardDraftAction(versionId: number): Promise<{ ok: boolean; message: string }> {
  const s = await requireOwner();
  try {
    await discardDraft(versionId, s.userId);
  } catch (e) {
    return { ok: false, message: e instanceof PromptError ? e.message : "Something went wrong." };
  }
  revalidatePath("/admin/phone/prompts");
  return { ok: true, message: "Draft set aside (kept in the history). The live line is unchanged." };
}

export async function restoreVersionAction(versionId: number): Promise<{ ok: boolean; message: string }> {
  const s = await requireOwner();
  try {
    await restoreVersion(versionId, s.userId);
  } catch (e) {
    return { ok: false, message: e instanceof PromptError ? e.message : "Something went wrong. Nothing changed." };
  }
  revalidatePath("/admin/phone/prompts");
  return { ok: true, message: "That version is live again." };
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
