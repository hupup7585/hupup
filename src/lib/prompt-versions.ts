import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { PROMPTS, type PromptDef, type PromptKey } from "@/lib/ivr/prompts";
import { googleTtsReady, makeGoogleRecording } from "@/lib/prompt-recordings";

/**
 * Drafts and versions for every phone line and message (Abraham, Nov 13, 2026). Owner only (checked by the actions).
 *  - Edit: saves a draft "Waiting for approval"; the live wording keeps playing.
 *  - Approve: the draft goes live (and, once Google Text-to-Speech is set up, a new Google voice recording is made).
 *  - Every version is kept with its date; any old version can be made live again.
 */
export type Version = typeof schema.promptVersions.$inferSelect;

export class PromptError extends Error {}

export function validateWording(key: string, text: string): string {
  if (!(key in PROMPTS)) throw new PromptError("Unknown line.");
  const def = PROMPTS[key as PromptKey] as PromptDef;
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) throw new PromptError("Write the wording first.");
  if (/<[^>]+>/.test(clean)) throw new PromptError("Plain text only: no tags.");
  const max = def.message ? 1600 : 600;
  if (clean.length > max) throw new PromptError(`Please keep it under ${max} characters.`);
  if (!def.message && clean.includes("\n")) throw new PromptError("A spoken line is one paragraph (no new lines).");
  const missing = (def.vars ?? []).filter((v) => !clean.includes(`{${v}}`));
  if (missing.length) throw new PromptError(`Keep these changing parts in the wording: ${missing.map((m) => `{${m}}`).join(", ")}`);
  return clean;
}

/** The wording live now: Admin's approved version, else the original wording in the code. */
export async function liveText(key: PromptKey): Promise<string> {
  const [row] = await db.select().from(schema.voicePrompts).where(eq(schema.voicePrompts.key, key)).limit(1);
  return row?.text?.trim() || PROMPTS[key].text;
}

export async function versionsFor(key: string) {
  return db.select().from(schema.promptVersions).where(eq(schema.promptVersions.promptKey, key)).orderBy(desc(schema.promptVersions.createdAt), desc(schema.promptVersions.id));
}

export async function allVersions() {
  return db.select().from(schema.promptVersions).orderBy(desc(schema.promptVersions.createdAt), desc(schema.promptVersions.id));
}

/** Edit: a new draft (an older open draft for the same line is set aside, kept). */
export async function saveDraft(key: string, text: string, userId: number | null) {
  const clean = validateWording(key, text);
  if (clean === (await liveText(key as PromptKey))) throw new PromptError("That's the wording already live.");
  await db.update(schema.promptVersions).set({ status: "discarded" }).where(and(eq(schema.promptVersions.promptKey, key), eq(schema.promptVersions.status, "draft")));
  const [v] = await db.insert(schema.promptVersions).values({ promptKey: key, text: clean, status: "draft", createdBy: userId }).returning();
  await db.insert(schema.auditLog).values({ userId, action: "voice_prompt.draft", entityType: "voice_prompt", entityId: key, after: { versionId: v.id, text: clean } });
  return v;
}

async function makeLive(key: string, text: string, userId: number | null, versionId: number) {
  const now = new Date();
  // The wording before this one is kept as a version too (the first time, that's the original wording in the code)
  const [current] = await db.select().from(schema.promptVersions).where(and(eq(schema.promptVersions.promptKey, key), eq(schema.promptVersions.status, "live"))).limit(1);
  if (current) await db.update(schema.promptVersions).set({ status: "replaced" }).where(eq(schema.promptVersions.id, current.id));
  else {
    const before = await liveText(key as PromptKey);
    // Dated just before this line's first version, so the history reads in order
    const [first] = await db.select({ at: schema.promptVersions.createdAt }).from(schema.promptVersions).where(eq(schema.promptVersions.promptKey, key)).orderBy(schema.promptVersions.createdAt).limit(1);
    await db.insert(schema.promptVersions).values({ promptKey: key, text: before, status: "replaced", note: before === PROMPTS[key as PromptKey].text ? "Original wording" : "Wording before version history", createdAt: new Date((first?.at ?? now).getTime() - 1000) });
  }
  const def = PROMPTS[key as PromptKey] as PromptDef;
  const stored = text === def.text ? null : text;
  await db
    .insert(schema.voicePrompts)
    .values({ key, text: stored, updatedBy: userId, ...(def.pending ? { approvedAt: now, approvedBy: userId } : {}) })
    .onConflictDoUpdate({ target: schema.voicePrompts.key, set: { text: stored, updatedAt: now, updatedBy: userId, ...(def.pending ? { approvedAt: now, approvedBy: userId } : {}) } });
  await db.update(schema.promptVersions).set({ status: "live", approvedBy: userId, approvedAt: now }).where(eq(schema.promptVersions.id, versionId));
  // The new Google voice recording (same voice), once Google Text-to-Speech is set up; changing parts stay live voice
  let recorded = false;
  if (!def.message && !def.vars?.length && !def.textOnly && googleTtsReady()) {
    recorded = Boolean(await makeGoogleRecording(key, text, userId).catch(() => null));
  }
  return { recorded };
}

/** Approve the draft: it goes live (the live line until now is kept as an old version). */
export async function approveDraft(versionId: number, userId: number | null) {
  const [v] = await db.select().from(schema.promptVersions).where(eq(schema.promptVersions.id, versionId)).limit(1);
  if (!v || v.status !== "draft") throw new PromptError("That draft isn't waiting for approval.");
  validateWording(v.promptKey, v.text);
  const r = await makeLive(v.promptKey, v.text, userId, v.id);
  await db.insert(schema.auditLog).values({ userId, action: "voice_prompt.approved", entityType: "voice_prompt", entityId: v.promptKey, after: { versionId: v.id, text: v.text, recorded: r.recorded } });
  return r;
}

export async function discardDraft(versionId: number, userId: number | null) {
  const [v] = await db.select().from(schema.promptVersions).where(eq(schema.promptVersions.id, versionId)).limit(1);
  if (!v || v.status !== "draft") throw new PromptError("That draft isn't waiting for approval.");
  await db.update(schema.promptVersions).set({ status: "discarded" }).where(eq(schema.promptVersions.id, v.id));
  await db.insert(schema.auditLog).values({ userId, action: "voice_prompt.draft_discarded", entityType: "voice_prompt", entityId: v.promptKey, after: { versionId: v.id } });
}

/** Go back to an older version: it becomes live again (as a new version, so the history stays in order). */
export async function restoreVersion(versionId: number, userId: number | null) {
  const [old] = await db.select().from(schema.promptVersions).where(eq(schema.promptVersions.id, versionId)).limit(1);
  if (!old || old.status === "live" || old.status === "draft") throw new PromptError("Choose an older version.");
  validateWording(old.promptKey, old.text);
  const [v] = await db.insert(schema.promptVersions).values({ promptKey: old.promptKey, text: old.text, status: "draft", note: `Restored from the version of ${old.createdAt.toISOString()}`, createdBy: userId }).returning();
  const r = await makeLive(old.promptKey, old.text, userId, v.id);
  await db.insert(schema.auditLog).values({ userId, action: "voice_prompt.restored", entityType: "voice_prompt", entityId: old.promptKey, after: { fromVersion: old.id, versionId: v.id } });
  return r;
}
