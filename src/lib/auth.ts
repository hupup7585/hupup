import crypto from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { config, BUSINESS_NAME } from "@/lib/config";
import { sendEmail, sendSms } from "@/lib/notify";

const { loginCodes, adminSessions } = schema;

export const SESSION_COOKIE = "hup_admin";
const CODE_TTL_MIN = 10;
const MAX_ATTEMPTS = 5;
const MAX_SENDS_PER_10_MIN = 5;
const TRUSTED_DAYS = 30;
const SHORT_SESSION_HOURS = 12;

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

export type Channel = "sms" | "email";

export function maskedDestination(channel: Channel) {
  if (channel === "sms") {
    const d = config.adminPhone().replace(/\D/g, "");
    return d ? `(•••) •••-••${d.slice(-2)}` : "(not set)";
  }
  const e = config.adminEmail();
  const [user, domain] = e.split("@");
  return user && domain ? `${user.slice(0, 2)}•••@${domain}` : "(not set)";
}

export async function sendLoginCode(channel: Channel): Promise<{ ok: boolean; error?: string; devCode?: string }> {
  const dest = channel === "sms" ? config.adminPhone() : config.adminEmail();
  if (!dest) return { ok: false, error: `No admin ${channel === "sms" ? "phone" : "email"} is configured.` };

  const recent = await db.execute(
    sql`SELECT COUNT(*)::int AS n FROM login_codes WHERE created_at > now() - interval '10 minutes'`,
  );
  if ((recent.rows[0] as { n: number }).n >= MAX_SENDS_PER_10_MIN) {
    return { ok: false, error: "Too many codes requested. Please wait a few minutes." };
  }

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  await db.insert(loginCodes).values({
    channel,
    codeHash: hmac(code),
    expiresAt: new Date(Date.now() + CODE_TTL_MIN * 60_000),
  });

  const msg = `${BUSINESS_NAME} admin code: ${code}. It expires in ${CODE_TTL_MIN} minutes. If you didn't request it, ignore this message.`;
  const res =
    channel === "sms" ? await sendSms(dest, msg, { kind: "system", event: "login_code", log: false }) : await sendEmail(dest, `Your ${BUSINESS_NAME} sign-in code: ${code}`, msg);
  if (!res.sent) return { ok: false, error: res.error || "Could not send the code." };
  return { ok: true, devCode: res.dev ? code : undefined };
}

export async function verifyLoginCode(code: string, trustDevice: boolean): Promise<{ ok: boolean; error?: string }> {
  const clean = code.replace(/\D/g, "");
  if (clean.length !== 6) return { ok: false, error: "Enter the 6-digit code." };

  const [latest] = await db
    .select()
    .from(loginCodes)
    .where(and(isNull(loginCodes.usedAt), gt(loginCodes.expiresAt, new Date())))
    .orderBy(desc(loginCodes.createdAt))
    .limit(1);
  if (!latest) return { ok: false, error: "That code expired. Request a new one." };
  if (latest.attempts >= MAX_ATTEMPTS) return { ok: false, error: "Too many attempts. Request a new code." };

  await db.update(loginCodes).set({ attempts: latest.attempts + 1 }).where(eq(loginCodes.id, latest.id));
  if (!safeEqual(hmac(clean), latest.codeHash)) return { ok: false, error: "Incorrect code. Try again." };

  await db.update(loginCodes).set({ usedAt: new Date() }).where(eq(loginCodes.id, latest.id));

  const token = crypto.randomBytes(32).toString("base64url");
  const ms = trustDevice ? TRUSTED_DAYS * 86_400_000 : SHORT_SESSION_HOURS * 3_600_000;
  const expiresAt = new Date(Date.now() + ms);
  const ua = (await headers()).get("user-agent")?.slice(0, 300) ?? null;
  await db.insert(adminSessions).values({ tokenHash: hmac(token), expiresAt, userAgent: ua });

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.isProd(),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  return { ok: true };
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

/** For pages and server actions: redirect to login if not signed in. */
export async function requireAdmin() {
  const s = await getSession();
  if (!s) redirect("/admin/login");
  return s;
}

export async function logout() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(adminSessions).where(eq(adminSessions.tokenHash, hmac(token)));
  jar.delete(SESSION_COOKIE);
}
