import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { parseEditor, type Editor } from "@/lib/ivr/menu-editor";
import { unwrapValue, wrapValue, writeSettingValue } from "@/lib/settings";

/**
 * Phone screens, draft first (Admin handoff Phase 3, section 6; Hark's review M13, Nov 26, 2026). Every change on the
 * Phone screens pages (order of lines, lines on or off, added or removed lines, keys) goes to a draft. Callers keep
 * hearing the live screens until the Owner publishes. Publishing records a version (who, when, before and after) in
 * the same history as every setting; Undo makes the version before into a new draft. Nothing is deleted.
 */
export const LIVE_KEY = "screenEditor";
export const DRAFT_KEY = "screenEditorDraft";

export class ScreenDraftError extends Error {}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const inTx = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => (typeof db.transaction === "function" ? db.transaction(fn) : fn(db as unknown as Tx));

async function raw(key: string, tx: Pick<typeof db, "select"> = db): Promise<unknown> {
  const [row] = await tx.select({ value: schema.appSettings.value }).from(schema.appSettings).where(eq(schema.appSettings.key, key)).limit(1);
  return row?.value ?? null;
}

export async function liveEditor(): Promise<Editor> {
  return parseEditor(await raw(LIVE_KEY));
}
/** The draft, or null when there is none. */
export async function draftEditor(): Promise<Editor | null> {
  const v = await raw(DRAFT_KEY);
  return v && typeof v === "object" ? parseEditor(v) : null;
}
/** What the Owner is editing: the draft when there is one, else the live screens. */
export async function editingEditor(): Promise<Editor> {
  return (await draftEditor()) ?? (await liveEditor());
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Which screens the draft changes (compared with live), for the banner. */
export async function draftChanges(): Promise<string[]> {
  const d = await draftEditor();
  if (!d) return [];
  const l = await liveEditor();
  const ids = new Set([...Object.keys(d.layouts), ...Object.keys(d.extra), ...Object.keys(d.keys), ...Object.keys(l.layouts), ...Object.keys(l.extra), ...Object.keys(l.keys)]);
  return [...ids].filter((id) => !same(d.layouts[id], l.layouts[id]) || !same(d.extra[id], l.extra[id]) || !same(d.keys[id], l.keys[id])).sort();
}

/** Save an edit into the draft (audited). */
export async function saveScreenDraft(screen: string, before: Editor, after: Editor, userId: number | null, action: string) {
  await db
    .insert(schema.appSettings)
    .values({ key: DRAFT_KEY, value: after as never, updatedAt: new Date(), updatedBy: userId })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: after as never, updatedAt: new Date(), updatedBy: userId } });
  await db.insert(schema.auditLog).values({ userId, action: `${action}_draft`, entityType: "settings", entityId: `screen:${screen}`, before, after });
}

/** Publish the draft: callers hear it from the next call step. One transaction; the version is recorded. */
export async function publishScreens(userId: number | null, reason: string) {
  const why = reason.trim();
  if (why.length < 3) throw new ScreenDraftError("Write a short reason for the change (it is kept in the history).");
  // What keys may point at (items, recordings), read before the transaction (Hark's review item 4)
  const { brokenKeys, loadKeyTargets } = await import("@/lib/screen-keys");
  const targets = await loadKeyTargets();
  return inTx(async (tx) => {
    const draft = await raw(DRAFT_KEY, tx);
    if (!draft || typeof draft !== "object") throw new ScreenDraftError("There are no draft changes to publish.");
    const live = await raw(LIVE_KEY, tx);
    if (same(draft, live)) throw new ScreenDraftError("The draft is the same as the live screens. Nothing to publish.");
    // Hark's review item 3: the whole draft is checked again; no Admin key on a protected step
    const { protectedKeyProblems, PROTECTED_REASON } = await import("@/lib/ivr/menu-editor");
    const bad = protectedKeyProblems(draft as never);
    if (bad.length) throw new ScreenDraftError(`Not published. ${PROTECTED_REASON} Remove these keys first: ${bad.join(", ")}.`);
    // Hark's review item 4: every key's target is checked again (an item archived since, a recording removed ...)
    const broken = brokenKeys(draft as never, targets);
    if (broken.length) throw new ScreenDraftError(`Not published. These keys do not work: ${broken.map((b) => `${b.screen} key ${b.key} (${b.problem})`).join("; ")}`);
    await writeSettingValue(tx, LIVE_KEY, draft, userId);
    await writeSettingValue(tx, DRAFT_KEY, null, userId);
    await tx.update(schema.configVersions).set({ status: "replaced" }).where(and(eq(schema.configVersions.key, LIVE_KEY), eq(schema.configVersions.status, "live")));
    const [row] = await tx
      .insert(schema.configVersions)
      .values({ key: LIVE_KEY, value: wrapValue(draft), previous: wrapValue(live), status: "live", reason: why.slice(0, 300), createdBy: userId, publishedBy: userId, publishedAt: new Date() })
      .returning();
    await tx.insert(schema.auditLog).values({ userId, action: "phone.screens_published", entityType: "settings", entityId: LIVE_KEY, before: live as never, after: { version: row.id, reason: why } });
    return row.id;
  });
}

/** Throw the draft away; the live screens did not change. */
export async function discardScreens(userId: number | null) {
  const d = await raw(DRAFT_KEY);
  if (!d || typeof d !== "object") throw new ScreenDraftError("There are no draft changes.");
  await writeSettingValue(db, DRAFT_KEY, null, userId);
  await db.insert(schema.auditLog).values({ userId, action: "phone.screens_draft_discarded", entityType: "settings", entityId: DRAFT_KEY, before: d as never });
}

/** Undo the last publish: the screens from before it become a new draft (publish it to make it live). */
export async function undoScreens(userId: number | null) {
  return inTx(async (tx) => {
    const d = await raw(DRAFT_KEY, tx);
    if (d && typeof d === "object") throw new ScreenDraftError("There are draft changes waiting. Publish or discard them first.");
    const [last] = await tx.select().from(schema.configVersions).where(and(eq(schema.configVersions.key, LIVE_KEY), eq(schema.configVersions.status, "live"))).orderBy(desc(schema.configVersions.id)).limit(1);
    if (!last) throw new ScreenDraftError("Nothing has been published on Phone screens yet.");
    const live = await raw(LIVE_KEY, tx);
    if (!same(unwrapValue(last.value), live)) throw new ScreenDraftError("The live screens changed since the last publish. Nothing changed.");
    const before = unwrapValue(last.previous) ?? {};
    await writeSettingValue(tx, DRAFT_KEY, before, userId);
    await tx.insert(schema.auditLog).values({ userId, action: "phone.screens_undo_drafted", entityType: "settings", entityId: LIVE_KEY, after: { undoOf: last.id } });
  });
}
