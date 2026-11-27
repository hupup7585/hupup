import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { BUSINESS_NAME, config } from "@/lib/config";

/**
 * Sensitive switches (Hark's Phases 1-3 review, item 9, Nov 26, 2026): turning ON call recording, the paid Google voice,
 * PhonePay or the Stripe card provider needs a fresh code sent to the Owner's own phone (and email when set up) plus a
 * typed confirmation, so nobody turns on something that costs money or records callers by a stray click or on a
 * device left signed in. Turning them OFF is never blocked. The check runs only while the Owner switch
 * "sensitiveSwitchGuard" is on (it starts off until Abraham approves the screenshots).
 */
export const SENSITIVE_SWITCHES = {
  callRecording: { label: "call recording", phrase: "TURN ON CALL RECORDING" },
  googleLiveVoice: { label: "the paid Google voice", phrase: "TURN ON GOOGLE VOICE" },
  solaPhonePayOn: { label: "card payments on the phone (PhonePay)", phrase: "TURN ON PHONEPAY" },
  stripeProvider: { label: "Stripe as the phone card provider", phrase: "USE STRIPE" },
} as const;
export type SensitiveSwitch = keyof typeof SENSITIVE_SWITCHES;

const KEY = "sensitiveSwitchCode";
const TTL_MIN = 10;
const MAX_TRIES = 5;
const hash = (code: string) => crypto.createHmac("sha256", process.env.AUTH_SECRET || "dev-secret").update(`switch:${code}`).digest("hex");
type Stored = { userId: number | null; sw: SensitiveSwitch; hash: string; exp: number; tries: number };

async function read(): Promise<Stored | null> {
  const [row] = await db.select({ value: schema.appSettings.value }).from(schema.appSettings).where(eq(schema.appSettings.key, KEY)).limit(1);
  const v = row?.value as Stored | null | undefined;
  return v && typeof v === "object" && "hash" in v ? v : null;
}
async function write(v: Stored | null, userId: number | null) {
  await db
    .insert(schema.appSettings)
    .values({ key: KEY, value: v as never, updatedBy: userId })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: v as never, updatedAt: new Date(), updatedBy: userId } });
}

export async function guardOn(): Promise<boolean> {
  const { getSettings } = await import("@/lib/settings");
  return Boolean((await getSettings()).sensitiveSwitchGuard);
}

/** Send a fresh code for one switch to the Owner's own phone (and email). devCode only on a test site. */
export async function requestSwitchCode(userId: number | null, sw: SensitiveSwitch): Promise<{ ok: boolean; message: string; devCode?: string }> {
  if (!(sw in SENSITIVE_SWITCHES)) return { ok: false, message: "Unknown switch." };
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  await write({ userId, sw, hash: hash(code), exp: Date.now() + TTL_MIN * 60_000, tries: 0 }, userId);
  const text = `${BUSINESS_NAME} Admin: your code to turn on ${SENSITIVE_SWITCHES[sw].label} is ${code}. It expires in ${TTL_MIN} minutes. If you did not ask for it, ignore it.`;
  const { sendSms, sendEmail } = await import("@/lib/notify");
  const phone = config.adminPhone();
  const sms = phone ? await sendSms(phone, text, { kind: "system", event: "switch_code", log: false }).catch(() => ({ sent: false, dev: false })) : { sent: false, dev: false };
  const email = config.adminEmail() ? await sendEmail(config.adminEmail(), `${BUSINESS_NAME} Admin code`, text, [], { record: false }).catch(() => ({ sent: false })) : { sent: false };
  await db.insert(schema.auditLog).values({ userId, action: "settings.switch_code_sent", entityType: "settings", entityId: sw, after: { sms: sms.sent, email: email.sent } });
  const dev = "dev" in sms && sms.dev ? code : undefined;
  if (!sms.sent && !email.sent && !dev) return { ok: false, message: "The code could not be sent (texting and email are not set up). Ask Hark to turn the safety check off on All settings meanwhile." };
  return { ok: true, message: `A code was sent to the Owner's ${sms.sent ? "phone" : "email"}. It works for ${TTL_MIN} minutes.`, devCode: dev };
}

/** Check the code and the typed words for this switch. The code works once. */
export async function checkSwitchCode(userId: number | null, sw: SensitiveSwitch, code: string, typed: string): Promise<string | null> {
  const want = SENSITIVE_SWITCHES[sw].phrase;
  if ((typed ?? "").trim().toUpperCase() !== want) return `Type ${want} in the box to confirm.`;
  const s = await read();
  if (!s || s.sw !== sw || s.exp < Date.now()) return "Ask for a new code first (Send me a code). Codes work for 10 minutes.";
  if (s.tries >= MAX_TRIES) return "Too many wrong codes. Ask for a new code.";
  if (hash((code ?? "").trim()) !== s.hash) {
    await write({ ...s, tries: s.tries + 1 }, userId);
    return "That code is not right. Check the text and try again.";
  }
  await write(null, userId); // used once
  return null;
}

/** For a switch being turned ON while the safety check is on: the reason it is refused, or null when allowed. */
export async function sensitiveRefusal(userId: number | null, sw: SensitiveSwitch, turningOn: boolean, form: { get(k: string): unknown }): Promise<string | null> {
  if (!turningOn || !(await guardOn())) return null;
  return checkSwitchCode(userId, sw, String(form.get("switchCode") ?? ""), String(form.get("switchTyped") ?? ""));
}
