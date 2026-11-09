import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { config, BUSINESS_NAME, OWNER_FULL_NAME } from "@/lib/config";
import { sendEmail, sendSms } from "@/lib/notify";
import { toE164 } from "@/lib/phone";
import type { Role } from "@/lib/db/schema";

/**
 * Staff sign-in (Abram's decision): Owner and Secretary sign in with a password or a texted code; Delivery
 * with a texted code only. Codes go to the staff member's own phone; the owner's go to ADMIN_PHONE
 * (845-777-7585). Every sign-in attempt is written to the audit log.
 */

const { loginCodes, adminSessions, adminUsers } = schema;

export const SESSION_COOKIE = "hup_admin";
const CODE_TTL_MIN = 10;
const MAX_ATTEMPTS = 5;
const MAX_SENDS_PER_10_MIN = 5;
const TRUSTED_DAYS = 30;
const SHORT_SESSION_HOURS = 12;
export const MAX_PASSWORD_FAILURES = 5;
export const LOCK_MINUTES = 15;
export const MIN_PASSWORD_LENGTH = 10;

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || (config.isProd() && s.length < 24)) throw new Error("AUTH_SECRET must be set (24+ chars)");
  return s;
}

export function hmac(value: string) {
  return crypto.createHmac("sha256", secret()).update(value).digest("hex");
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export type StaffUser = { userId: number | null; role: Role; name: string; phone: string };

/** Who may sign in with this phone: an active staff account, or the owner's phone (ADMIN_PHONE) before accounts exist. */
export async function staffForPhone(rawPhone: string): Promise<StaffUser | null> {
  const phone = toE164(rawPhone);
  if (!phone) return null;
  const [u] = await db.select().from(adminUsers).where(eq(adminUsers.phone, phone)).limit(1);
  if (u) return u.active ? { userId: u.id, role: u.role, name: u.name, phone } : null;
  if (toE164(config.adminPhone()) === phone) return { userId: null, role: "owner", name: OWNER_FULL_NAME, phone };
  return null;
}

async function audit(action: string, userId: number | null, after: Record<string, unknown>) {
  const h = await headers();
  await db.insert(schema.auditLog).values({
    userId,
    action,
    entityType: "staff_login",
    after,
    ip: (h.get("x-forwarded-for") || "").split(",")[0].trim() || null,
    userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
  });
}

const GENERIC = "If that number belongs to a staff account, a code is on its way.";
/** Abraham: the Owner can also get the sign-in code by email; it always goes to this address. */
export const OWNER_CODE_EMAIL = "hupupattractions@gmail.com";

/** Where a staff member's email code goes: their saved email; the Owner falls back to the business email. */
async function staffEmail(staff: StaffUser): Promise<string | null> {
  if (staff.userId) {
    const [u] = await db.select({ email: adminUsers.email }).from(adminUsers).where(eq(adminUsers.id, staff.userId)).limit(1);
    if (u?.email?.trim()) return u.email.trim();
  }
  return staff.role === "owner" ? OWNER_CODE_EMAIL : null;
}
const GENERIC_EMAIL = "If that number has a staff account with a saved email, a code is on its way to that email.";
/**
 * Text codes only work once Twilio approves our texting registration (A2P 10DLC); until then carriers drop the texts.
 * On the live site we say so plainly instead of pretending a code is on its way. (Test and preview builds keep the
 * on-screen dev code.)
 */
export function smsLoginActive(env: Record<string, string | undefined> = process.env): boolean {
  if (env.VERCEL_ENV !== "production") return true;
  return Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_MESSAGING_SERVICE_SID);
}
export function emailLoginActive(env: Record<string, string | undefined> = process.env): boolean {
  return env.VERCEL_ENV !== "production" || Boolean(env.RESEND_API_KEY);
}
export const SMS_LOGIN_NOT_ACTIVE =
  "Not active yet: text codes start once Twilio approves our texting registration (A2P). Use \"By email\" or your password instead.";

export const EMAIL_NOT_SET_UP = "Not active yet: email codes need the email sender set up. Use your password instead.";

/**
 * Owner only: email the sign-in code to OWNER_CODE_EMAIL. Same 10-minute expiry, 5 attempts and send limit as the
 * text code. The reply never reveals whether the number is the Owner's.
 */
export async function sendLoginEmailCode(rawPhone: string): Promise<{ ok: boolean; message: string; devCode?: string }> {
  if (!emailLoginActive()) return { ok: false, message: EMAIL_NOT_SET_UP };
  const staff = await staffForPhone(rawPhone);
  // Abraham: the code goes to that staff member's saved email (the Owner: the business email if none is saved).
  // Delivery staff sign in by text code only.
  const to = !staff || staff.role === "delivery" ? null : await staffEmail(staff);
  if (!staff || !to) {
    await audit("login.email_code_refused", staff?.userId ?? null, { phone: toE164(rawPhone), role: staff?.role ?? null, reason: !staff ? "unknown" : staff.role === "delivery" ? "delivery_text_only" : "no_email" });
    return { ok: true, message: GENERIC_EMAIL };
  }
  const channel = `email:${staff.phone}`;
  const recent = await db.execute(sql`SELECT COUNT(*)::int AS n FROM login_codes WHERE channel = ${channel} AND created_at > now() - interval '10 minutes'`);
  if ((recent.rows[0] as { n: number }).n >= MAX_SENDS_PER_10_MIN) return { ok: false, message: "Too many codes requested. Please wait a few minutes." };
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const res = await sendEmail(to, `${BUSINESS_NAME} sign-in code: ${code}`, `${BUSINESS_NAME} staff sign-in code: ${code}\n\nIt expires in ${CODE_TTL_MIN} minutes. If you didn't request it, ignore this email.`);
  await audit("login.email_code_sent", staff.userId, { role: staff.role, sent: res.sent });
  if (!res.sent) return { ok: false, message: EMAIL_NOT_SET_UP };
  await db.insert(loginCodes).values({ userId: staff.userId, channel, codeHash: hmac(code), expiresAt: new Date(Date.now() + CODE_TTL_MIN * 60_000) });
  return { ok: true, message: GENERIC_EMAIL, devCode: res.dev ? code : undefined };
}

/** Text a sign-in code. The reply never reveals whether the number has an account. */
export async function sendLoginCode(rawPhone: string): Promise<{ ok: boolean; message: string; devCode?: string }> {
  if (!smsLoginActive()) return { ok: false, message: SMS_LOGIN_NOT_ACTIVE };
  const staff = await staffForPhone(rawPhone);
  if (!staff) {
    await audit("login.code_unknown_number", null, { phone: toE164(rawPhone) });
    return { ok: true, message: GENERIC };
  }
  // Rate limit per staff phone (not business-wide, so one person can't block everyone else's codes).
  const recent = await db.execute(sql`SELECT COUNT(*)::int AS n FROM login_codes WHERE channel = ${`sms:${staff.phone}`} AND created_at > now() - interval '10 minutes'`);
  if ((recent.rows[0] as { n: number }).n >= MAX_SENDS_PER_10_MIN) return { ok: false, message: "Too many codes requested. Please wait a few minutes." };

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  await db.insert(loginCodes).values({ userId: staff.userId, channel: `sms:${staff.phone}`, codeHash: hmac(code), expiresAt: new Date(Date.now() + CODE_TTL_MIN * 60_000) });
  const msg = `${BUSINESS_NAME} staff sign-in code: ${code}. It expires in ${CODE_TTL_MIN} minutes. If you didn't request it, ignore this message.`;
  const res = await sendSms(staff.phone, msg, { kind: "system", event: "login_code", log: false });
  await audit("login.code_sent", staff.userId, { role: staff.role, sent: res.sent });
  if (!res.sent) return { ok: false, message: res.error || "Could not send the code." };
  return { ok: true, message: GENERIC, devCode: res.dev ? code : undefined };
}

async function startSession(staffIn: StaffUser, method: "sms_code" | "email_code" | "password", trustDevice: boolean) {
  // The Owner (ADMIN_PHONE) becomes a real account on first sign-in, so the Owner can set a password and own history.
  let staff = staffIn;
  if (staff.role === "owner" && !staff.userId) {
    const [row] = await db.select().from(adminUsers).where(eq(adminUsers.phone, staff.phone)).limit(1);
    const owner = row ?? (await db.insert(adminUsers).values({ name: OWNER_FULL_NAME, phone: staff.phone, role: "owner", active: true }).returning())[0];
    staff = { ...staff, userId: owner.id };
  }
  const token = crypto.randomBytes(32).toString("base64url");
  const ms = trustDevice ? TRUSTED_DAYS * 86_400_000 : SHORT_SESSION_HOURS * 3_600_000;
  const expiresAt = new Date(Date.now() + ms);
  const ua = (await headers()).get("user-agent")?.slice(0, 300) ?? null;
  await db.insert(adminSessions).values({ userId: staff.userId, method, tokenHash: hmac(token), expiresAt, userAgent: ua });
  if (staff.userId) await db.update(adminUsers).set({ lastLoginAt: new Date(), failedLogins: 0, lockedUntil: null }).where(eq(adminUsers.id, staff.userId));
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, secure: config.isProd(), sameSite: "lax", path: "/", expires: expiresAt });
  await audit("login.success", staff.userId, { role: staff.role, method });
}

export async function verifyLoginCode(rawPhone: string, code: string, trustDevice: boolean, via: "sms" | "email" = "sms"): Promise<{ ok: boolean; error?: string; role?: Role }> {
  const clean = code.replace(/\D/g, "");
  if (clean.length !== 6) return { ok: false, error: "Enter the 6-digit code." };
  const staff = await staffForPhone(rawPhone);
  if (!staff || (via === "email" && staff.role === "delivery")) return { ok: false, error: "That code is not valid. Request a new one." };
  const [latest] = await db
    .select()
    .from(loginCodes)
    .where(and(eq(loginCodes.channel, `${via}:${staff.phone}`), isNull(loginCodes.usedAt), gt(loginCodes.expiresAt, new Date())))
    .orderBy(desc(loginCodes.createdAt))
    .limit(1);
  if (!latest) return { ok: false, error: "That code expired. Request a new one." };
  if (latest.attempts >= MAX_ATTEMPTS) return { ok: false, error: "Too many attempts. Request a new code." };
  await db.update(loginCodes).set({ attempts: latest.attempts + 1 }).where(eq(loginCodes.id, latest.id));
  if (!safeEqual(hmac(clean), latest.codeHash)) {
    await audit("login.code_failed", staff.userId, { role: staff.role });
    return { ok: false, error: "Incorrect code. Try again." };
  }
  await db.update(loginCodes).set({ usedAt: new Date() }).where(eq(loginCodes.id, latest.id));
  await startSession(staff, via === "email" ? "email_code" : "sms_code", trustDevice);
  return { ok: true, role: staff.role };
}

/** Password sign-in: Owner and Secretary only (Delivery is refused here, not just hidden in the form). */
export async function passwordLogin(rawPhone: string, password: string, trustDevice: boolean): Promise<{ ok: boolean; error?: string; role?: Role }> {
  const generic = "Phone number or password is not correct.";
  const phone = toE164(rawPhone);
  const [u] = phone ? await db.select().from(adminUsers).where(eq(adminUsers.phone, phone)).limit(1) : [];
  if (!u || !u.active || !u.passwordHash) {
    await audit("login.password_failed", u?.id ?? null, { reason: !u ? "unknown" : !u.active ? "inactive" : "no_password" });
    return { ok: false, error: generic };
  }
  if (u.role === "delivery") {
    await audit("login.password_refused_delivery", u.id, {});
    return { ok: false, error: "Delivery accounts sign in with a texted code." };
  }
  if (u.lockedUntil && u.lockedUntil > new Date()) {
    await audit("login.password_locked", u.id, {});
    return { ok: false, error: `${generic} Too many tries: try again later or use a texted code.` };
  }
  if (!(await bcrypt.compare(password, u.passwordHash))) {
    const failures = u.failedLogins + 1;
    const lock = failures >= MAX_PASSWORD_FAILURES ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null;
    await db.update(adminUsers).set({ failedLogins: lock ? 0 : failures, lockedUntil: lock }).where(eq(adminUsers.id, u.id));
    await audit(lock ? "login.locked" : "login.password_failed", u.id, { failures });
    return { ok: false, error: lock ? `${generic} Too many tries: try again later or use a texted code.` : generic };
  }
  await startSession({ userId: u.id, role: u.role, name: u.name, phone: u.phone }, "password", trustDevice);
  return { ok: true, role: u.role };
}

export async function hashPassword(pw: string) {
  if (pw.length < MIN_PASSWORD_LENGTH) throw new Error(`Passwords need at least ${MIN_PASSWORD_LENGTH} characters.`);
  return bcrypt.hash(pw, 12);
}

export async function getSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const [s] = await db
    .select()
    .from(adminSessions)
    .where(and(eq(adminSessions.tokenHash, hmac(token)), gt(adminSessions.expiresAt, new Date())))
    .limit(1);
  return s ?? null;
}

/** The signed-in staff member (role checked against the current account, so deactivation takes effect at once). */
export async function currentStaff(): Promise<(StaffUser & { sessionId: number }) | null> {
  const s = await getSession();
  if (!s) return null;
  if (!s.userId) return { userId: null, role: "owner", name: OWNER_FULL_NAME, phone: toE164(config.adminPhone()) ?? "", sessionId: s.id };
  const [u] = await db.select().from(adminUsers).where(eq(adminUsers.id, s.userId)).limit(1);
  if (!u?.active) return null;
  return { userId: u.id, role: u.role, name: u.name, phone: u.phone, sessionId: s.id };
}

export function homeFor(role: Role) {
  return role === "delivery" ? "/admin/deliveries" : role === "secretary" ? "/admin/calendar" : "/admin";
}

/** Owner or Secretary (booking tools). Delivery accounts are sent to their delivery screen. */
export async function requireAdmin() {
  const s = await currentStaff();
  if (!s) redirect("/admin/login");
  if (s.role === "delivery") redirect("/admin/deliveries");
  return s;
}

/** Owner only (settings, staff, catalog, hotline prompts, finances). */
export async function requireOwner() {
  const s = await requireAdmin();
  if (s.role !== "owner") redirect(homeFor(s.role));
  return s;
}

/** Any of the given roles. */
export async function requireStaff(roles: Role[]) {
  const s = await currentStaff();
  if (!s) redirect("/admin/login");
  if (!roles.includes(s.role)) redirect(homeFor(s.role));
  return s;
}

export async function logout() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(adminSessions).where(eq(adminSessions.tokenHash, hmac(token)));
  jar.delete(SESSION_COOKIE);
}

/** Revoke every session for a staff member (deactivation, password reset). */
export async function revokeSessions(userId: number) {
  await db.delete(adminSessions).where(eq(adminSessions.userId, userId));
}

/**
 * My account: Owner and Secretary set or change their own password. Changing an existing password needs the current
 * one; setting the first password needs a sign-in from the last 15 minutes. Delivery accounts use text codes only.
 */
export async function setOwnPassword(current: string, next: string): Promise<{ ok: boolean; message: string }> {
  const me = await currentStaff();
  if (!me?.userId) return { ok: false, message: "Please sign in again." };
  if (me.role === "delivery") return { ok: false, message: "Delivery accounts sign in with a texted code only." };
  const [u] = await db.select().from(adminUsers).where(eq(adminUsers.id, me.userId)).limit(1);
  if (!u) return { ok: false, message: "Account not found." };
  if (u.passwordHash) {
    if (!(await bcrypt.compare(current, u.passwordHash))) {
      await audit("account.password_change_failed", u.id, {});
      return { ok: false, message: "Your current password isn't right." };
    }
  } else {
    const [sess] = await db.select().from(adminSessions).where(eq(adminSessions.id, me.sessionId)).limit(1);
    if (!sess || Date.now() - sess.createdAt.getTime() > 15 * 60_000) return { ok: false, message: "For your first password, sign in again with a code, then set it within 15 minutes." };
  }
  let hash: string;
  try {
    hash = await hashPassword(next);
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  await db.update(adminUsers).set({ passwordHash: hash, passwordSetAt: new Date(), failedLogins: 0, lockedUntil: null }).where(eq(adminUsers.id, u.id));
  await audit(u.passwordHash ? "account.password_changed" : "account.password_set", u.id, {});
  return { ok: true, message: "Password saved. You can now sign in with your phone number and password." };
}
