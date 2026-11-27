import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { config } from "@/lib/config";
import { hmac } from "@/lib/auth";
import { sendEmail } from "@/lib/notify";

/*
 * Owner-only API Keys page (Abraham, Nov 14, 2026).
 *  - Opened with its own page password (not the Admin sign-in) plus a 6-digit code emailed to the Owner (text code
 *    once Twilio approves texting). Locks again after 10 minutes with no activity.
 *  - 5 wrong tries (password or code) lock the page for 30 minutes and email the Owner.
 *  - Values are stored encrypted (AES-256-GCM) and only the last 4 characters are ever shown. There is no way to
 *    show or copy a full value, and values never go in logs or emails.
 *  - Saving a key also sends it to Vercel (the live system reads keys there) when VERCEL_API_TOKEN is set.
 *  - Every open, add, replace, delete, failed password and failed code is logged with time, account, IP and device.
 *    The log is append-only (the database itself refuses edits and deletes).
 */
export const KEYS_COOKIE = "hup_keys";
export const UNLOCK_MINUTES = 10;
export const MAX_TRIES = 5;
export const LOCKOUT_MINUTES = 30;
export const CODE_MINUTES = 10;
const PAGE_PW_KEY = "api_keys_page_password";
const CODE_CHANNEL = "api-keys:email";

/* ---------- encryption ---------- */

function encKey(env: Record<string, string | undefined> = process.env) {
  const secret = env.KEYS_SECRET || env.AUTH_SECRET;
  if (!secret) throw new Error("The encryption secret isn't set up.");
  return Buffer.from(crypto.hkdfSync("sha256", secret, "hupup-api-keys", "v1", 32));
}

export function encryptValue(value: string, env?: Record<string, string | undefined>) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", encKey(env), iv);
  const data = Buffer.concat([c.update(value, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), data.toString("base64")].join(".");
}

/** Only used to send a key to Vercel; never shown on any page. */
export function decryptValue(enc: string, env?: Record<string, string | undefined>) {
  const [v, iv, tag, data] = enc.split(".");
  if (v !== "v1") throw new Error("Unknown key format.");
  const d = crypto.createDecipheriv("aes-256-gcm", encKey(env), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
}

export const last4 = (value: string) => value.trim().slice(-4);
export const masked = (l4: string) => `•••• ${l4}`;
export const validKeyName = (n: string) => /^[A-Z][A-Z0-9_]{2,63}$/.test(n);

/* ---------- log ---------- */

type Who = { userId: number | null; ip?: string | null; userAgent?: string | null };

export async function logKeys(who: Who, action: string, opts: { keyName?: string | null; ok?: boolean } = {}) {
  await db.insert(schema.apiKeysLog).values({ userId: who.userId, action, keyName: opts.keyName ?? null, ok: opts.ok ?? true, ip: who.ip ?? null, userAgent: who.userAgent?.slice(0, 300) ?? null });
}

export async function keysLog(limit = 100) {
  return db.select().from(schema.apiKeysLog).orderBy(desc(schema.apiKeysLog.at)).limit(limit);
}

/* ---------- page password, code, lockout ---------- */

export async function pagePasswordSet() {
  const [r] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, PAGE_PW_KEY)).limit(1);
  return typeof r?.value === "string" && r.value.length > 0;
}

async function pagePasswordHash() {
  const [r] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, PAGE_PW_KEY)).limit(1);
  return typeof r?.value === "string" ? r.value : null;
}

export const validPagePassword = (pw: string) => pw.length >= 12;

/** When the page is locked out (5 failures since the last success, the newest under 30 minutes ago). */
export async function lockedUntil(now = new Date()): Promise<Date | null> {
  const since = new Date(now.getTime() - LOCKOUT_MINUTES * 60_000);
  const [lock] = await db
    .select()
    .from(schema.apiKeysLog)
    .where(and(eq(schema.apiKeysLog.action, "locked_out"), gt(schema.apiKeysLog.at, since)))
    .orderBy(desc(schema.apiKeysLog.at))
    .limit(1);
  return lock ? new Date(lock.at.getTime() + LOCKOUT_MINUTES * 60_000) : null;
}

async function failuresSinceLastGood() {
  const rows = await db.select().from(schema.apiKeysLog).orderBy(desc(schema.apiKeysLog.at)).limit(50);
  let n = 0;
  for (const r of rows) {
    if (r.action === "unlocked" || r.action === "locked_out" || r.action === "page_password_set") break;
    if (r.action === "failed_password" || r.action === "failed_code") n++;
  }
  return n;
}

async function noteFailure(who: Who, action: "failed_password" | "failed_code") {
  await logKeys(who, action, { ok: false });
  if ((await failuresSinceLastGood()) >= MAX_TRIES) {
    await logKeys(who, "locked_out", { ok: false });
    const to = config.adminEmail();
    if (to)
      await sendEmail(
        to,
        "Hup Up Attractions: API Keys page locked",
        `Someone entered a wrong API Keys password or code ${MAX_TRIES} times. The page is locked for ${LOCKOUT_MINUTES} minutes.\n\nIP: ${who.ip ?? "unknown"}\nDevice: ${who.userAgent ?? "unknown"}\n\nEvery attempt is listed on the API Keys page log.`,
      ).catch(() => null);
  }
}

/** Email a fresh 6-digit code to the Owner. Returns the masked address it went to. */
async function emailCode(who: Who) {
  const to = config.adminEmail();
  if (!to) throw new Error("No Owner email is set up.");
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  await db.update(schema.loginCodes).set({ usedAt: new Date() }).where(and(eq(schema.loginCodes.channel, CODE_CHANNEL), isNull(schema.loginCodes.usedAt)));
  await db.insert(schema.loginCodes).values({ userId: who.userId, channel: CODE_CHANNEL, codeHash: hmac(code), expiresAt: new Date(Date.now() + CODE_MINUTES * 60_000) });
  await sendEmail(to, `Hup Up Attractions API Keys code: ${code}`, `Your code to open the API Keys page is ${code}. It works for ${CODE_MINUTES} minutes. If you did not ask for it, someone may know the page password: change it.`, [], { kind: "code" }); // deep check 06:00 M65: the Sent copy hides the code
  await logKeys(who, "unlock_code_sent");
  const [u, d] = to.split("@");
  return `${u.slice(0, 1)}***@${d}`;
}

/** Step 1: the page password. Right: a code is emailed. */
export async function checkPagePassword(pw: string, who: Who): Promise<{ ok: boolean; message: string; sentTo?: string }> {
  if (await lockedUntil()) return { ok: false, message: `Locked for ${LOCKOUT_MINUTES} minutes after too many wrong tries.` };
  const h = await pagePasswordHash();
  if (!h || !(await bcrypt.compare(pw, h))) {
    await noteFailure(who, "failed_password");
    return { ok: false, message: "That password isn't right." };
  }
  const sentTo = await emailCode(who);
  return { ok: true, message: `We emailed a 6-digit code to ${sentTo}.`, sentTo };
}

/** Step 2: the emailed code. Right: the page is unlocked for 10 minutes of activity; returns the cookie token. */
export async function checkCode(code: string, who: Who): Promise<{ ok: boolean; message: string; token?: string }> {
  if (await lockedUntil()) return { ok: false, message: `Locked for ${LOCKOUT_MINUTES} minutes after too many wrong tries.` };
  const [row] = await db
    .select()
    .from(schema.loginCodes)
    .where(and(eq(schema.loginCodes.channel, CODE_CHANNEL), isNull(schema.loginCodes.usedAt), gt(schema.loginCodes.expiresAt, new Date())))
    .orderBy(desc(schema.loginCodes.createdAt))
    .limit(1);
  if (!row || row.codeHash !== hmac(code.trim())) {
    await noteFailure(who, "failed_code");
    return { ok: false, message: "That code isn't right, or it has run out. Enter the password again for a new one." };
  }
  await db.update(schema.loginCodes).set({ usedAt: new Date() }).where(eq(schema.loginCodes.id, row.id));
  const token = crypto.randomBytes(32).toString("base64url");
  await db.insert(schema.apiKeysUnlocks).values({ userId: who.userId ?? 0, tokenHash: hmac(token), expiresAt: new Date(Date.now() + UNLOCK_MINUTES * 60_000) });
  await logKeys(who, "unlocked");
  return { ok: true, message: "Unlocked.", token };
}

/** Is this cookie token unlocked? Activity keeps it open another 10 minutes. */
export async function isUnlocked(token: string | undefined, userId: number | null, now = new Date()): Promise<boolean> {
  if (!token) return false;
  const [u] = await db
    .select()
    .from(schema.apiKeysUnlocks)
    .where(and(eq(schema.apiKeysUnlocks.tokenHash, hmac(token)), gt(schema.apiKeysUnlocks.expiresAt, now)))
    .limit(1);
  if (!u || u.userId !== (userId ?? 0)) return false;
  await db.update(schema.apiKeysUnlocks).set({ expiresAt: new Date(now.getTime() + UNLOCK_MINUTES * 60_000) }).where(eq(schema.apiKeysUnlocks.id, u.id));
  return true;
}

export async function lockNow(token: string | undefined) {
  if (token) await db.update(schema.apiKeysUnlocks).set({ expiresAt: new Date() }).where(eq(schema.apiKeysUnlocks.tokenHash, hmac(token)));
}

/** First time (or a change): set the page password. Needs a code emailed to the Owner first. */
export async function requestSetupCode(who: Who) {
  return emailCode(who);
}

export async function setPagePassword(pw: string, code: string, who: Who): Promise<{ ok: boolean; message: string; token?: string }> {
  if (!validPagePassword(pw)) return { ok: false, message: "Use at least 12 characters." };
  const r = await checkCode(code, who);
  if (!r.ok) return r;
  const value = await bcrypt.hash(pw, 12);
  await db
    .insert(schema.appSettings)
    .values({ key: PAGE_PW_KEY, value, updatedBy: who.userId })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value, updatedAt: new Date(), updatedBy: who.userId } });
  await logKeys(who, "page_password_set");
  return { ok: true, message: "Page password saved.", token: r.token };
}

/* ---------- keys ---------- */

export type KeyRow = Omit<typeof schema.apiKeys.$inferSelect, "valueEnc">;

export async function listKeys(): Promise<KeyRow[]> {
  const rows = await db.select().from(schema.apiKeys).orderBy(schema.apiKeys.service, schema.apiKeys.name);
  return rows.map(({ valueEnc: _v, ...r }) => (void _v, r));
}

/** Add or replace a key (paste the new value, confirm). The old value is overwritten. */
export async function saveKey(input: { name: string; service: string; purpose: string; mode: string; value: string }, who: Who) {
  const name = input.name.trim().toUpperCase();
  const value = input.value.trim();
  if (!validKeyName(name)) throw new Error("Use the variable name in capitals, like STRIPE_READ_KEY.");
  if (value.length < 8) throw new Error("That key looks too short.");
  const mode = input.mode === "live" ? "live" : "test";
  const [before] = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.name, name)).limit(1);
  const values = { service: input.service.trim() || name, purpose: input.purpose.trim() || null, mode, valueEnc: encryptValue(value), last4: last4(value), updatedAt: new Date(), updatedBy: who.userId };
  if (before) await db.update(schema.apiKeys).set({ ...values, vercelSyncedAt: null, vercelError: null }).where(eq(schema.apiKeys.id, before.id));
  else await db.insert(schema.apiKeys).values({ name, ...values });
  await logKeys(who, before ? "replace" : "add", { keyName: name });
  await syncToVercel(name, value);
  return { replaced: Boolean(before) };
}

/** Delete needs the page password again. */
export async function deleteKey(name: string, pw: string, who: Who): Promise<{ ok: boolean; message: string }> {
  const h = await pagePasswordHash();
  if (!h || !(await bcrypt.compare(pw, h))) {
    await noteFailure(who, "failed_password");
    return { ok: false, message: "That password isn't right." };
  }
  const [k] = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.name, name)).limit(1);
  if (!k) return { ok: false, message: "Key not found." };
  await db.delete(schema.apiKeys).where(eq(schema.apiKeys.id, k.id));
  await logKeys(who, "delete", { keyName: name });
  return { ok: true, message: `${name} deleted here. It stays in Vercel until removed there.` };
}

/* ---------- Vercel ---------- */

export const VERCEL_PROJECT_ID = "prj_up1mx7xYS3tEkS51ja1zGT7jwy2r";
export const VERCEL_TEAM_ID = "team_qWwbYMFY6Dg7TZToXAHVxYaI";

/** Sends a saved key to Vercel (production and preview, marked sensitive). Needs VERCEL_API_TOKEN. */
export async function syncToVercel(name: string, value: string, fetcher: typeof fetch = fetch, env: Record<string, string | undefined> = process.env) {
  const token = env.VERCEL_API_TOKEN;
  if (!token) {
    await db.update(schema.apiKeys).set({ vercelError: "Not sent: the Vercel connection isn't set up yet." }).where(eq(schema.apiKeys.name, name));
    return false;
  }
  try {
    const res = await fetcher(`https://api.vercel.com/v10/projects/${VERCEL_PROJECT_ID}/env?upsert=true&teamId=${VERCEL_TEAM_ID}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ key: name, value, type: "sensitive", target: ["production", "preview"] }),
    });
    if (!res.ok) throw new Error(`Vercel answered ${res.status}`);
    await db.update(schema.apiKeys).set({ vercelSyncedAt: new Date(), vercelError: null }).where(eq(schema.apiKeys.name, name));
    return true;
  } catch (e) {
    await db.update(schema.apiKeys).set({ vercelError: (e as Error).message.slice(0, 200) }).where(eq(schema.apiKeys.name, name));
    return false;
  }
}

/** For the page: Vercel variable names that already exist there (never their values). */
export async function vercelKeyNames(fetcher: typeof fetch = fetch, env: Record<string, string | undefined> = process.env): Promise<string[] | null> {
  const token = env.VERCEL_API_TOKEN;
  if (!token) return null;
  try {
    const res = await fetcher(`https://api.vercel.com/v10/projects/${VERCEL_PROJECT_ID}/env?teamId=${VERCEL_TEAM_ID}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const j = (await res.json()) as { envs?: { key: string }[] };
    return [...new Set((j.envs ?? []).map((e) => e.key))].sort();
  } catch {
    return null;
  }
}

