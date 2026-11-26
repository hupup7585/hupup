import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getSettings, saveSetting } from "@/lib/settings";
import { configDef, validateConfig } from "@/lib/config-registry";

/**
 * Draft, publish, discard and undo for every Admin setting (Admin handoff Phase 2, Nov 26, 2026). A draft never
 * affects customers. Publishing writes the live value (app_settings, what the phone and website read) and records the
 * version, the previous value, who published it and when, in config_versions and the activity log. Undo publishes the
 * value from before as a new version: history is never edited or erased.
 */
export class ConfigError extends Error {}

/** Values are kept wrapped ({ v }) so "12" stays the text "12" (the database turns a bare "12" into the number 12). */
const wrap = (v: unknown) => ({ v }) as never;
export const unwrap = (x: unknown): unknown => (x && typeof x === "object" && "v" in (x as object) ? (x as { v: unknown }).v : x);
const same = (a: unknown, b: unknown) => (typeof a === "object" || typeof b === "object" ? JSON.stringify(a) === JSON.stringify(b) : String(a) === String(b));

async function liveValue(key: string): Promise<unknown> {
  return ((await getSettings()) as Record<string, unknown>)[key];
}

export async function currentDraft(key: string) {
  const [d] = await db.select().from(schema.configVersions).where(and(eq(schema.configVersions.key, key), eq(schema.configVersions.status, "draft"))).orderBy(desc(schema.configVersions.createdAt)).limit(1);
  return d ?? null;
}

export async function configHistory(key: string, limit = 10) {
  return db.select().from(schema.configVersions).where(eq(schema.configVersions.key, key)).orderBy(desc(schema.configVersions.id)).limit(limit);
}

/** Save a draft (replaces an earlier draft of the same setting, which is kept as discarded). */
export async function saveDraft(key: string, raw: string, userId: number | null, reason = "") {
  const def = configDef(key);
  if (!def) throw new ConfigError("Unknown setting.");
  const v = validateConfig(def, raw);
  if (!v.ok) throw new ConfigError(v.error);
  const live = await liveValue(key);
  if (same(live, v.value)) throw new ConfigError("That is already the live value. Nothing to save.");
  await db.update(schema.configVersions).set({ status: "discarded" }).where(and(eq(schema.configVersions.key, key), eq(schema.configVersions.status, "draft")));
  const [row] = await db.insert(schema.configVersions).values({ key, value: wrap(v.value), previous: wrap(live), status: "draft", reason: reason.trim().slice(0, 300) || null, createdBy: userId }).returning();
  await db.insert(schema.auditLog).values({ userId, action: "config.draft_saved", entityType: "config", entityId: key, before: { value: live }, after: { value: v.value, reason: row.reason } });
  return row;
}

/** Publish the draft: the Owner's approval. Customer wording needs approveWords = true (the exact words approved). */
export async function publishDraft(key: string, userId: number | null, opts: { approveWords?: boolean } = {}) {
  const def = configDef(key);
  if (!def) throw new ConfigError("Unknown setting.");
  const draft = await currentDraft(key);
  if (!draft) throw new ConfigError("There is no draft to publish.");
  if (def.wording && !opts.approveWords) throw new ConfigError("These are customer words: tick that you approve the exact words before publishing.");
  const before = await liveValue(key);
  await saveSetting(key as never, unwrap(draft.value) as never, userId);
  await db.update(schema.configVersions).set({ status: "live", publishedBy: userId, publishedAt: new Date(), previous: wrap(before) }).where(eq(schema.configVersions.id, draft.id));
  await db.insert(schema.auditLog).values({ userId, action: def.wording ? "config.words_approved_published" : "config.published", entityType: "config", entityId: key, before: { value: before }, after: { value: unwrap(draft.value), version: draft.id } });
  return draft.id;
}

export async function discardDraft(key: string, userId: number | null) {
  const draft = await currentDraft(key);
  if (!draft) throw new ConfigError("There is no draft.");
  await db.update(schema.configVersions).set({ status: "discarded" }).where(eq(schema.configVersions.id, draft.id));
  await db.insert(schema.auditLog).values({ userId, action: "config.draft_discarded", entityType: "config", entityId: key, after: { version: draft.id } });
}

/** Undo the last published change: the value from before it becomes a new draft (publish it to make it live). */
export async function undoLast(key: string, userId: number | null) {
  const [last] = await db.select().from(schema.configVersions).where(and(eq(schema.configVersions.key, key), eq(schema.configVersions.status, "live"))).orderBy(desc(schema.configVersions.publishedAt)).limit(1);
  if (!last) throw new ConfigError("Nothing has been published here yet.");
  const live = await liveValue(key);
  await db.update(schema.configVersions).set({ status: "discarded" }).where(and(eq(schema.configVersions.key, key), eq(schema.configVersions.status, "draft")));
  const [row] = await db.insert(schema.configVersions).values({ key, value: last.previous as never, previous: wrap(live), status: "draft", reason: `Undo of version ${last.id}`, createdBy: userId }).returning();
  await db.insert(schema.auditLog).values({ userId, action: "config.undo_drafted", entityType: "config", entityId: key, before: { value: live }, after: { value: unwrap(last.previous), undoOf: last.id } });
  return row;
}
