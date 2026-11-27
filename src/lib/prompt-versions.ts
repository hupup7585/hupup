import { and, desc, eq, sql } from "drizzle-orm";
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

/** A short form like "it's", "we'll" or "don't" in a spoken line, or null (possessives like "Abraham's" are fine). */
export function shortForm(text: string): string | null {
  const m = /\b([A-Za-z]+['’](?:ll|re|ve|m|d|t)|(?:it|that|there|here|what|let|he|she|who|where)['’]s)\b/i.exec(text);
  return m ? m[1] : null;
}

/** Lines where Abraham approved "Let's" (Nov 22, 2026): the empty cart and the shared did-not-catch line. */
export const LETS_ALLOWED = new Set(["cart_empty", "field_unclear"]);

export function validateWording(key: string, text: string): string {
  if (!(key in PROMPTS)) throw new PromptError("Unknown line.");
  const def = PROMPTS[key as PromptKey] as PromptDef;
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) throw new PromptError("Write the wording first.");
  if (/<[^>]+>/.test(clean)) throw new PromptError("Plain text only: no tags.");
  const max = def.message ? 1600 : def.lines ? 1200 : 600;
  if (clean.length > max) throw new PromptError(`Please keep it under ${max} characters.`);
  if (!def.message && !def.lines && clean.includes("\n")) throw new PromptError("A spoken line is one paragraph (no new lines).");
  // No short forms in any phone prompt (Abraham, Nov 17, 2026): "it is", never "it's"
  // Abraham's one approved exception (Nov 22, 2026): "Let's start shopping!" in the empty cart line
  // "Let's" is allowed only in Abraham's approved lines (Nov 22, 2026)
  const short = def.message ? null : shortForm(LETS_ALLOWED.has(key) ? clean.replace(/\bLet['’]s\b/g, "Let us") : clean);
  if (short) throw new PromptError(`Please spell it out: no short forms on the phone (found "${short}"). For example "it is", "that is", "we will", "do not".`);
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
  const def = PROMPTS[key as PromptKey] as PromptDef;
  const stored = text === def.text ? null : text;
  // Extra check HP4 (Nov 27, 2026): one approval or restore at a time per line (a lock on the line), the version is
  // checked again inside the lock, and EVERY live row of the line is set aside, so two clicks never leave two live
  // versions or two "Original wording" rows
  const recordingId = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"prompt-version:" + key}))`);
    const [mine] = await tx.select({ status: schema.promptVersions.status }).from(schema.promptVersions).where(eq(schema.promptVersions.id, versionId)).limit(1);
    if (!mine || mine.status !== "draft") throw new PromptError("That draft isn't waiting for approval.");
    // The wording before this one is kept as a version too (the first time, that's the original wording in the code)
    const live = await tx.update(schema.promptVersions).set({ status: "replaced" }).where(and(eq(schema.promptVersions.promptKey, key), eq(schema.promptVersions.status, "live"))).returning({ id: schema.promptVersions.id });
    if (!live.length) {
      const [row] = await tx.select().from(schema.voicePrompts).where(eq(schema.voicePrompts.key, key)).limit(1);
      const before = row?.text?.trim() || PROMPTS[key as PromptKey].text;
      // Dated just before this line's first version, so the history reads in order
      const [first] = await tx.select({ at: schema.promptVersions.createdAt }).from(schema.promptVersions).where(eq(schema.promptVersions.promptKey, key)).orderBy(schema.promptVersions.createdAt).limit(1);
      await tx.insert(schema.promptVersions).values({ promptKey: key, text: before, status: "replaced", note: before === PROMPTS[key as PromptKey].text ? "Original wording" : "Wording before version history", createdAt: new Date((first?.at ?? now).getTime() - 1000) });
    }
    const [vp] = await tx
      .insert(schema.voicePrompts)
      .values({ key, text: stored, updatedBy: userId, ...(def.pending ? { approvedAt: now, approvedBy: userId } : {}) })
      .onConflictDoUpdate({ target: schema.voicePrompts.key, set: { text: stored, updatedAt: now, updatedBy: userId, ...(def.pending ? { approvedAt: now, approvedBy: userId } : {}) } })
      .returning({ recordingId: schema.voicePrompts.recordingId });
    await tx.update(schema.promptVersions).set({ status: "live", approvedBy: userId, approvedAt: now }).where(eq(schema.promptVersions.id, versionId));
    return vp?.recordingId ?? null;
  });
  // Extra check HP7: an uploaded recording on the line keeps playing (with the old words) until a new one is put on
  let hasUpload = false;
  if (recordingId) {
    const [rec] = await db.select({ source: schema.promptRecordings.source }).from(schema.promptRecordings).where(eq(schema.promptRecordings.id, recordingId)).limit(1);
    hasUpload = rec?.source === "upload";
  }
  // The new Google voice recording (same voice), once Google Text-to-Speech is set up; changing parts stay live voice
  let recorded = false;
  if (!def.message && !def.vars?.length && !def.textOnly && googleTtsReady()) {
    recorded = Boolean(await makeGoogleRecording(key, text, userId).catch(() => null));
  }
  return { recorded, hasUpload };
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
  const [v] = await db.insert(schema.promptVersions).values({ promptKey: old.promptKey, text: old.text, status: "draft", note: `Restored from the version of ${old.createdAt.toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" })}` /* HP10: New York time */, createdBy: userId }).returning();
  const r = await makeLive(old.promptKey, old.text, userId, v.id);
  await db.insert(schema.auditLog).values({ userId, action: "voice_prompt.restored", entityType: "voice_prompt", entityId: old.promptKey, after: { fromVersion: old.id, versionId: v.id } });
  return r;
}
