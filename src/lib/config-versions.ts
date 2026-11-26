import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { rawSetting, unwrapValue, wrapValue, writeSettingValue } from "@/lib/settings";
import { configDef, validateConfig } from "@/lib/config-registry";

/**
 * Draft, publish, discard and undo for every Admin setting (Admin handoff Phase 2, Nov 26, 2026), tightened after
 * Hark's review (H2, H3, M5, M6): a draft never affects customers; Publish makes exactly the draft the Owner was
 * looking at live (its version number), in one transaction, only if the setting did not change elsewhere since the
 * draft was made, and only after checking the value again. Undo is refused while a draft is waiting or when the
 * setting changed since. History is never edited or erased; every write anywhere in Admin is in it (saveSetting).
 */
export class ConfigError extends Error {}

export const wrap = wrapValue;
export const unwrap = unwrapValue;
const same = (a: unknown, b: unknown) => (typeof a === "object" || typeof b === "object" ? JSON.stringify(a) === JSON.stringify(b) : String(a) === String(b));
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const inTx = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => (typeof db.transaction === "function" ? db.transaction(fn) : fn(db as unknown as Tx));

export async function currentDraft(key: string) {
  const [d] = await db.select().from(schema.configVersions).where(and(eq(schema.configVersions.key, key), eq(schema.configVersions.status, "draft"))).orderBy(desc(schema.configVersions.id)).limit(1);
  return d ?? null;
}

export async function configHistory(key: string, limit = 10) {
  return db.select().from(schema.configVersions).where(eq(schema.configVersions.key, key)).orderBy(desc(schema.configVersions.id)).limit(limit);
}

/** Save a draft (an earlier draft of the same setting is kept as discarded). A reason is required (it is recorded). */
export async function saveDraft(key: string, raw: string, userId: number | null, reason = "") {
  const def = configDef(key);
  if (!def) throw new ConfigError("Unknown setting.");
  const v = validateConfig(def, raw);
  if (!v.ok) throw new ConfigError(v.error);
  const why = reason.trim();
  if (why.length < 3) throw new ConfigError("Write a short reason for the change (it is kept in the history).");
  return inTx(async (tx) => {
    const live = await rawSetting(key, tx);
    if (same(live, v.value)) throw new ConfigError("That is already the live value. Nothing to save.");
    await tx.update(schema.configVersions).set({ status: "discarded" }).where(and(eq(schema.configVersions.key, key), eq(schema.configVersions.status, "draft")));
    const [row] = await tx.insert(schema.configVersions).values({ key, value: wrap(v.value), previous: wrap(live), status: "draft", reason: why.slice(0, 300), createdBy: userId }).returning();
    await tx.insert(schema.auditLog).values({ userId, action: "config.draft_saved", entityType: "config", entityId: key, before: { value: live }, after: { value: v.value, reason: row.reason, version: row.id } });
    return row;
  });
}

/**
 * Publish exactly this draft (versionId): the Owner's approval. Customer words need approveWords (the exact words
 * approved). Refused when the draft is gone or not the current one, when the setting changed since the draft was made,
 * or when the value no longer passes its check. All or nothing.
 */
export async function publishDraft(key: string, versionId: number, userId: number | null, opts: { approveWords?: boolean } = {}) {
  const def = configDef(key);
  if (!def) throw new ConfigError("Unknown setting.");
  return inTx(async (tx) => {
    const [draft] = await tx.select().from(schema.configVersions).where(and(eq(schema.configVersions.id, versionId), eq(schema.configVersions.key, key))).for("update");
    if (!draft || draft.status !== "draft") throw new ConfigError("This draft is no longer waiting (it was published, discarded or replaced). Nothing changed. Review the page again.");
    const live = await rawSetting(key, tx);
    if (!same(unwrap(draft.previous), live)) throw new ConfigError("This setting changed since you made the draft. Nothing changed. Review it again and save a new draft.");
    const check = validateConfig(def, String(unwrap(draft.value) ?? ""));
    if (!check.ok) throw new ConfigError(check.error);
    if (def.wording && !opts.approveWords) throw new ConfigError("These are customer words: tick that you approve the exact words before publishing.");
    await writeSettingValue(tx, key, check.value, userId);
    await tx.update(schema.configVersions).set({ status: "replaced" }).where(and(eq(schema.configVersions.key, key), eq(schema.configVersions.status, "live")));
    await tx.update(schema.configVersions).set({ status: "live", publishedBy: userId, publishedAt: new Date() }).where(eq(schema.configVersions.id, draft.id));
    await tx.insert(schema.auditLog).values({ userId, action: def.wording ? "config.words_approved_published" : "config.published", entityType: "config", entityId: key, before: { value: live }, after: { value: check.value, version: draft.id } });
    return draft.id;
  });
}

export async function discardDraft(key: string, versionId: number, userId: number | null) {
  return inTx(async (tx) => {
    const [draft] = await tx.select().from(schema.configVersions).where(and(eq(schema.configVersions.id, versionId), eq(schema.configVersions.key, key))).for("update");
    if (!draft || draft.status !== "draft") throw new ConfigError("There is no such draft waiting. Nothing changed.");
    await tx.update(schema.configVersions).set({ status: "discarded" }).where(eq(schema.configVersions.id, draft.id));
    await tx.insert(schema.auditLog).values({ userId, action: "config.draft_discarded", entityType: "config", entityId: key, after: { version: draft.id } });
  });
}

/**
 * Undo the last change: the value from before it becomes a new draft (publish it to make it live). Refused while a
 * draft is waiting, when the setting changed since that change, or when the old value does not pass today's check.
 */
export async function undoLast(key: string, userId: number | null) {
  const def = configDef(key);
  if (!def) throw new ConfigError("Unknown setting.");
  return inTx(async (tx) => {
    const [waiting] = await tx.select({ id: schema.configVersions.id }).from(schema.configVersions).where(and(eq(schema.configVersions.key, key), eq(schema.configVersions.status, "draft"))).limit(1);
    if (waiting) throw new ConfigError("A draft is waiting for this setting. Publish or discard it first.");
    const [last] = await tx.select().from(schema.configVersions).where(and(eq(schema.configVersions.key, key), eq(schema.configVersions.status, "live"))).orderBy(desc(schema.configVersions.id)).limit(1);
    if (!last) throw new ConfigError("Nothing has been changed here yet.");
    const live = await rawSetting(key, tx);
    if (!same(unwrap(last.value), live)) throw new ConfigError("This setting changed since its last recorded change. Nothing changed.");
    const back = String(unwrap(last.previous) ?? "");
    const check = validateConfig(def, back);
    if (!check.ok) throw new ConfigError(`The value from before cannot be restored here: ${check.error}`);
    const [row] = await tx.insert(schema.configVersions).values({ key, value: wrap(check.value), previous: wrap(live), status: "draft", reason: `Undo of version ${last.id}`, createdBy: userId }).returning();
    await tx.insert(schema.auditLog).values({ userId, action: "config.undo_drafted", entityType: "config", entityId: key, before: { value: live }, after: { value: check.value, undoOf: last.id } });
    return row;
  });
}
