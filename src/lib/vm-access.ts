import bcrypt from "bcryptjs";
import { and, desc, eq, gt } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { config } from "@/lib/config";
import { sendEmail } from "@/lib/notify";
import { formatPhone } from "@/lib/phone";

/**
 * Staff voicemail access from any phone (Abraham, Nov 13 and Nov 15, 2026). Only from the general voicemail (main menu
 * key 9): while its greeting plays, star 7 4, pressed without a pause of 3 seconds or more (never announced), asks
 * for the password. Then each box by its number, or 0 to call a customer out from (845) 777-7585. 3 wrong tries end the call and lock access for 15 minutes; the Owner
 * gets an email about every lockout. PREVIEW ONLY until Abraham approves it and the call-back price.
 */
export const VM_ACCESS_LIVE_APPROVED = false;
export const VM_ACCESS_KEYS = "*74";
/** Seconds allowed between the keys of star 7 4. */
export const VM_ACCESS_KEY_GAP = 3;
export const VM_PIN_TRIES = 3;
export const VM_LOCK_MINUTES = 15;
/** Call-backs show the business number (a verified caller ID in Twilio). */
export const CALLBACK_CALLER_ID = "+18457777585";

const PIN_KEY = "vm_access_pin_hash";

export function vmAccessActive(env: Record<string, string | undefined> = process.env) {
  return VM_ACCESS_LIVE_APPROVED || env.VERCEL_ENV !== "production";
}

export function validPin(pin: string) {
  return /^\d{4,8}$/.test(pin);
}

/** Owner sets or changes the PIN in Admin. Only the bcrypt hash is stored. */
export async function setVmPin(pin: string, userId: number | null) {
  if (!validPin(pin)) throw new Error("The PIN must be 4 to 8 digits.");
  const value = await bcrypt.hash(pin, 10);
  await db
    .insert(schema.appSettings)
    .values({ key: PIN_KEY, value, updatedBy: userId })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value, updatedAt: new Date(), updatedBy: userId } });
}

async function pinHash(): Promise<string | null> {
  const [r] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, PIN_KEY)).limit(1);
  return typeof r?.value === "string" && r.value ? r.value : null;
}

export async function vmPinSet() {
  return Boolean(await pinHash());
}

export async function checkVmPin(pin: string) {
  const h = await pinHash();
  return Boolean(h && pin && (await bcrypt.compare(pin, h)));
}

export async function logVmAccess(callSid: string | null, from: string | null, result: "ok" | "wrong_pin" | "locked" | "refused_locked" | "no_pin" | "pin_changed") {
  await db.insert(schema.vmAccessLog).values({ callSid, fromNumber: from, result });
}

/** When access is locked (the last lockout was under 15 minutes ago), until when. */
export async function vmLockedUntil(now = new Date()): Promise<Date | null> {
  const since = new Date(now.getTime() - VM_LOCK_MINUTES * 60_000);
  const [r] = await db
    .select()
    .from(schema.vmAccessLog)
    .where(and(eq(schema.vmAccessLog.result, "locked"), gt(schema.vmAccessLog.createdAt, since)))
    .orderBy(desc(schema.vmAccessLog.createdAt))
    .limit(1);
  return r ? new Date(r.createdAt.getTime() + VM_LOCK_MINUTES * 60_000) : null;
}

/** 3 wrong tries: lock for 15 minutes and email the Owner. */
export async function lockVmAccess(callSid: string | null, from: string | null, now = new Date()) {
  await logVmAccess(callSid, from, "locked");
  const to = config.adminEmail();
  if (!to) return;
  const when = now.toLocaleString("en-US", { timeZone: process.env.BUSINESS_TIMEZONE || "America/New_York", dateStyle: "medium", timeStyle: "short" });
  await sendEmail(
    to,
    "Hup Up Attractions: voicemail access locked",
    `Someone entered a wrong voicemail PIN ${VM_PIN_TRIES} times on the hotline.\n\nCalling from: ${from ? formatPhone(from) : "withheld number"}\nTime: ${when}\n\nVoicemail access by phone is locked for ${VM_LOCK_MINUTES} minutes. Every sign-in is listed in Admin > Voicemail.`,
  ).catch((e) => console.error("[vm access] lockout email failed:", e));
}

/** Password changed by phone: the Owner is emailed (the password itself is never sent or logged). */
export async function vmPinChangedByPhone(callSid: string | null, from: string | null, pin: string, now = new Date()) {
  await setVmPin(pin, null);
  await logVmAccess(callSid, from, "pin_changed");
  const to = config.adminEmail();
  if (!to) return;
  const when = now.toLocaleString("en-US", { timeZone: process.env.BUSINESS_TIMEZONE || "America/New_York", dateStyle: "medium", timeStyle: "short" });
  await sendEmail(
    to,
    "Hup Up Attractions: voicemail password changed",
    `The voicemail password was changed by phone.\n\nCalling from: ${from ? formatPhone(from) : "withheld number"}\nTime: ${when}\n\nIf this was not you, set a new password in Admin > Voicemail.`,
  ).catch((e) => console.error("[vm access] password change email failed:", e));
}

export async function recentVmAccess(limit = 50) {
  return db.select().from(schema.vmAccessLog).orderBy(desc(schema.vmAccessLog.createdAt)).limit(limit);
}

/**
 * Box chosen by its number on the keypad (Abraham, Nov 15, 2026): each extension's own number (extension 3 is main
 * menu key 4), 8 schools and corporate, 9 general voicemail, 1 the main box. 0 is no longer a box: it calls out.
 */
export const BOX_BY_NUMBER: Record<string, string> = { "1": "0", "2": "2", "3": "4", "5": "5", "6": "6", "8": "8", "9": "9" };

/** A number typed by staff to call out: 10 digits (or 1 and 10 digits), US or Canada, never 900 or 976. */
export function callOutNumber(digits: string | null | undefined): string | null {
  const d = (digits ?? "").replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return ten.length === 10 ? callbackNumber(`+1${ten}`) : null;
}

/** A number we may dial back: US or Canada, never premium 900 or 976. */
export function callbackNumber(from: string | null | undefined): string | null {
  if (!from || !/^\+1[2-9]\d{9}$/.test(from)) return null;
  if (/^\+1(900|976)/.test(from)) return null;
  return from;
}
