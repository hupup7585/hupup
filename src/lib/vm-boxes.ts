import bcrypt from "bcryptjs";
import { and, asc, eq, gt, inArray, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { BUSINESS_NAME, config } from "@/lib/config";
import { toE164 } from "@/lib/phone";
import { sendEmail } from "@/lib/notify";
import { VM_DEFAULT_PIN, VM_LOCK_MINUTES, VM_PIN_TRIES, validPin } from "@/lib/vm-access";
import { deletePieces } from "@/lib/vm-audio";
import { r2Delete } from "@/lib/r2";

/**
 * Full voicemail by phone (Abraham, Nov 23, 2026). Personal boxes for the Owner and the Secretary (each with its own
 * password, default 1234), plus the shared boxes (general voicemail and the extension boxes) they can open.
 */
export type Box = typeof schema.voicemailBoxes.$inferSelect;
export type Msg = typeof schema.voicemails.$inferSelect;
export type Mode = "new" | "saved" | "deleted";
export const DELETED_KEEP_DAYS = 30;
const PERSONAL_ROLES = ["owner", "secretary"] as const;

/** One personal box per active Owner and Secretary user (created the first time anyone signs in). */
export async function ensurePersonalBoxes(): Promise<Box[]> {
  const users = await db
    .select({ id: schema.adminUsers.id, name: schema.adminUsers.name, role: schema.adminUsers.role, email: schema.adminUsers.email, active: schema.adminUsers.active })
    .from(schema.adminUsers)
    .where(inArray(schema.adminUsers.role, [...PERSONAL_ROLES]));
  const have = await db.select().from(schema.voicemailBoxes).where(isNotNull(schema.voicemailBoxes.ownerUserId));
  const used = new Set(have.map((b) => b.boxNumber).filter(Boolean));
  for (const u of users.filter((x) => x.active !== false).sort((a, b) => (a.role === "owner" ? -1 : b.role === "owner" ? 1 : a.id - b.id))) {
    if (have.some((b) => b.ownerUserId === u.id)) continue;
    let n = u.role === "owner" ? 1 : 2;
    while (used.has(String(n))) n++;
    used.add(String(n));
    const [b] = await db
      .insert(schema.voicemailBoxes)
      .values({ name: `${u.name || (u.role === "owner" ? "Owner" : "Secretary")}`, ownerUserId: u.id, boxNumber: String(n), notifyEmail: u.email ? [u.email] : [] })
      .onConflictDoNothing()
      .returning();
    if (b) have.push(b);
  }
  return have;
}

/** Caller ID first (a staff phone saved in Admin), else null (then the box number is asked). */
export async function personalBoxForCaller(from: string | null | undefined): Promise<Box | null> {
  const e = toE164(from);
  if (!e) return null;
  await ensurePersonalBoxes();
  const [u] = await db
    .select({ id: schema.adminUsers.id })
    .from(schema.adminUsers)
    // Extra check F3 (Nov 27, 2026): a deactivated staff member's phone no longer opens their box
    .where(and(eq(schema.adminUsers.phone, e), inArray(schema.adminUsers.role, [...PERSONAL_ROLES]), eq(schema.adminUsers.active, true)))
    .limit(1);
  if (!u) return null;
  const [b] = await db.select().from(schema.voicemailBoxes).where(eq(schema.voicemailBoxes.ownerUserId, u.id)).limit(1);
  return b ?? null;
}

export async function boxByNumber(n: string): Promise<Box | null> {
  await ensurePersonalBoxes();
  const [b] = await db.select().from(schema.voicemailBoxes).where(and(eq(schema.voicemailBoxes.boxNumber, n.trim()), isNotNull(schema.voicemailBoxes.ownerUserId))).limit(1);
  if (!b) return null;
  // Extra check F3 (Nov 27, 2026): the box of a deactivated staff member can't be opened by its number either
  // (the caller hears the same "no such box" as for a wrong number); its messages stay for the Owner in Admin
  const [owner] = await db.select({ active: schema.adminUsers.active }).from(schema.adminUsers).where(eq(schema.adminUsers.id, b.ownerUserId!)).limit(1);
  return owner?.active ? b : null;
}

export async function getBox(id: number): Promise<Box | null> {
  const [b] = await db.select().from(schema.voicemailBoxes).where(eq(schema.voicemailBoxes.id, id)).limit(1);
  return b ?? null;
}

/** The password check: 3 wrong tries lock the box for 15 minutes and email the Owner. */
export async function checkBoxPin(box: Box, pin: string, now = new Date()): Promise<"ok" | "wrong" | "locked"> {
  if (box.lockedUntil && box.lockedUntil > now) return "locked";
  const ok = box.pinHash ? await bcrypt.compare(pin, box.pinHash) : pin === VM_DEFAULT_PIN;
  if (ok) {
    await db.update(schema.voicemailBoxes).set({ wrongTries: 0, lockedUntil: null }).where(eq(schema.voicemailBoxes.id, box.id));
    return "ok";
  }
  const tries = (box.lockedUntil && box.lockedUntil <= now ? 0 : box.wrongTries) + 1;
  if (tries >= VM_PIN_TRIES) {
    const until = new Date(now.getTime() + VM_LOCK_MINUTES * 60_000);
    await db.update(schema.voicemailBoxes).set({ wrongTries: 0, lockedUntil: until }).where(eq(schema.voicemailBoxes.id, box.id));
    if (config.adminEmail())
      await sendEmail(config.adminEmail(), `${BUSINESS_NAME}: voicemail box ${box.boxNumber ?? box.id} locked`, `Voicemail box ${box.boxNumber ?? ""} (${box.name}) was locked for ${VM_LOCK_MINUTES} minutes after ${VM_PIN_TRIES} wrong passwords on the phone.`).catch(() => null);
    return "locked";
  }
  await db.update(schema.voicemailBoxes).set({ wrongTries: tries }).where(eq(schema.voicemailBoxes.id, box.id));
  return "wrong";
}

export async function setBoxPin(boxId: number, pin: string) {
  if (!validPin(pin)) throw new Error("A password is 4 to 8 digits.");
  await db.update(schema.voicemailBoxes).set({ pinHash: await bcrypt.hash(pin, 10), wrongTries: 0, lockedUntil: null }).where(eq(schema.voicemailBoxes.id, boxId));
}

const visible = and(eq(schema.voicemails.state, "submitted"), isNull(schema.voicemails.purgedAt));

/** New (not heard), saved, or deleted (kept 30 days), oldest first. */
export async function listMessages(boxId: number, mode: Mode, now = new Date()): Promise<Msg[]> {
  const cutoff = new Date(now.getTime() - DELETED_KEEP_DAYS * 86_400_000);
  const where =
    mode === "new"
      ? and(isNull(schema.voicemails.deletedAt), isNull(schema.voicemails.heardAt))
      : mode === "saved"
        ? and(isNull(schema.voicemails.deletedAt), isNotNull(schema.voicemails.heardAt))
        : and(isNotNull(schema.voicemails.deletedAt), gt(schema.voicemails.deletedAt, cutoff));
  return db.select().from(schema.voicemails).where(and(eq(schema.voicemails.boxId, boxId), visible, where)).orderBy(asc(schema.voicemails.id));
}

export async function counts(boxId: number) {
  return { new: (await listMessages(boxId, "new")).length, saved: (await listMessages(boxId, "saved")).length, deleted: (await listMessages(boxId, "deleted")).length };
}

export async function getMsg(id: number): Promise<Msg | null> {
  const [v] = await db.select().from(schema.voicemails).where(eq(schema.voicemails.id, id)).limit(1);
  return v ?? null;
}

export async function logAction(a: { boxId?: number | null; voicemailId?: number | null; userId?: number | null; action: string; detail?: string | null; callSid?: string | null }) {
  await db.insert(schema.voicemailActions).values({ boxId: a.boxId ?? null, voicemailId: a.voicemailId ?? null, userId: a.userId ?? null, action: a.action, detail: a.detail ?? null, callSid: a.callSid ?? null });
}

export const saveMsg = (id: number) => db.update(schema.voicemails).set({ heardAt: new Date(), savedAt: new Date() }).where(eq(schema.voicemails.id, id));
export const eraseMsg = (id: number) => db.update(schema.voicemails).set({ deletedAt: new Date() }).where(eq(schema.voicemails.id, id));
export const restoreMsg = (id: number) => db.update(schema.voicemails).set({ deletedAt: null, heardAt: sql`COALESCE(${schema.voicemails.heardAt}, now())`, savedAt: new Date() }).where(eq(schema.voicemails.id, id));

/**
 * Erase forever: hidden for good; the pieces (and the Twilio recording) go only when no other copy (a forwarded one)
 * still plays the same audio.
 */
export async function eraseForever(id: number) {
  const v = await getMsg(id);
  if (!v) return;
  await db.update(schema.voicemails).set({ purgedAt: new Date() }).where(eq(schema.voicemails.id, id));
  if (v.noteKey) await r2Delete(v.noteKey).catch(() => null);
  const audioId = v.audioOf ?? v.id;
  const [other] = await db
    .select({ id: schema.voicemails.id })
    .from(schema.voicemails)
    .where(and(or(eq(schema.voicemails.id, audioId), eq(schema.voicemails.audioOf, audioId)), isNull(schema.voicemails.purgedAt), ne(schema.voicemails.id, id)))
    .limit(1);
  if (other) return;
  const [orig] = await db.select().from(schema.voicemails).where(eq(schema.voicemails.id, audioId)).limit(1);
  if (orig?.pieces) {
    await deletePieces(audioId, orig.pieces);
    await db.update(schema.voicemails).set({ pieces: null }).where(eq(schema.voicemails.id, audioId));
  }
}

/** Deleted messages older than 30 days are erased forever (daily). */
export async function purgeOldDeleted(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - DELETED_KEEP_DAYS * 86_400_000);
  const old = await db.select({ id: schema.voicemails.id }).from(schema.voicemails).where(and(isNotNull(schema.voicemails.deletedAt), lt(schema.voicemails.deletedAt, cutoff), isNull(schema.voicemails.purgedAt)));
  for (const o of old) await eraseForever(o.id);
  return old.length;
}

/** Every box the signed-in person can send to or forward to (personal and shared), except one. */
export async function otherBoxes(exceptId: number): Promise<Box[]> {
  await ensurePersonalBoxes();
  const all = await db.select().from(schema.voicemailBoxes).where(and(eq(schema.voicemailBoxes.enabled, true), ne(schema.voicemailBoxes.id, exceptId))).orderBy(asc(schema.voicemailBoxes.id));
  return all.slice(0, 9);
}

/** The shared boxes (general voicemail and the extension boxes). */
export async function sharedBoxes(): Promise<Box[]> {
  return (await db.select().from(schema.voicemailBoxes).where(and(isNull(schema.voicemailBoxes.ownerUserId), eq(schema.voicemailBoxes.enabled, true))).orderBy(asc(schema.voicemailBoxes.id))).slice(0, 9);
}

/** Staff with an email saved in Admin (forward by email). */
export async function staffEmails(): Promise<{ id: number; name: string; email: string }[]> {
  const rows = await db.select({ id: schema.adminUsers.id, name: schema.adminUsers.name, email: schema.adminUsers.email, active: schema.adminUsers.active }).from(schema.adminUsers).orderBy(asc(schema.adminUsers.id));
  return rows.filter((r) => r.email && r.active !== false).map((r) => ({ id: r.id, name: r.name || r.email!, email: r.email! })).slice(0, 9);
}

/** A copy in another box (the same audio; a recorded note can go first). */
export async function forwardToBox(v: Msg, toBoxId: number, fromBoxId: number, noteKey: string | null): Promise<number> {
  const [copy] = await db
    .insert(schema.voicemails)
    .values({ boxId: toBoxId, callSid: v.callSid, fromNumber: v.fromNumber, recordingSid: `fwd-${v.id}-${toBoxId}-${Date.now()}`, recordingUrl: v.recordingUrl, durationSec: v.durationSec, transcriptionStatus: "off", state: "submitted", fromBoxId, audioOf: v.audioOf ?? v.id, noteKey })
    .returning();
  return copy.id;
}

/** The caller's name when the number is a customer or in the directory. */
export async function callerName(number: string | null | undefined): Promise<string | null> {
  const e = toE164(number);
  if (!e) return null;
  const [c] = await db.select({ name: schema.customers.name }).from(schema.customers).where(eq(schema.customers.phone, e)).limit(1);
  if (c?.name?.trim()) return c.name.trim();
  try {
    const [d] = await db.select({ last: schema.directoryEntries.lastName, first: schema.directoryEntries.firstName }).from(schema.directoryEntries).where(eq(schema.directoryEntries.phone, e)).limit(2);
    return d ? [d.first, d.last].filter(Boolean).join(" ") : null;
  } catch {
    return null;
  }
}

/** Alerts for a personal box go to its owner's email (text alerts start after A2P). */
export async function setAlerts(box: Box, on: boolean) {
  const [u] = box.ownerUserId ? await db.select({ email: schema.adminUsers.email }).from(schema.adminUsers).where(eq(schema.adminUsers.id, box.ownerUserId)).limit(1) : [];
  await db.update(schema.voicemailBoxes).set({ alertsOn: on, notifyEmail: on && u?.email ? [u.email] : [] }).where(eq(schema.voicemailBoxes.id, box.id));
}
