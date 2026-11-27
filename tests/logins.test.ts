import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/* Staff sign-in on the live system (Abraham): Owner/Secretary password or text code; Delivery text code only. */
const h = vi.hoisted(() => ({ emails: [] as { text: string }[], cookies: new Map<string, string>(), sms: [] as string[] }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "1.2.3.4", "user-agent": "UA" }),
  cookies: async () => ({ set: (k: string, v: string) => h.cookies.set(k, v), get: (k: string) => (h.cookies.has(k) ? { value: h.cookies.get(k) } : undefined), delete: (k: string) => h.cookies.delete(k) }),
}));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error(`REDIRECT ${u}`); } }));
vi.mock("@/lib/notify", () => ({
  sendEmail: async (_to: string, _s: string, text: string) => (h.emails.push({ text }), { sent: true }),
  sendSms: async (to: string) => (h.sms.push(to), { sent: true }),
}));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { SMS_LOGIN_NOT_ACTIVE, currentStaff, hashPassword, passwordLogin, sendLoginCode, sendLoginEmailCode, setOwnPassword, smsLoginActive, verifyLoginCode } from "@/lib/auth";

const OWNER = "(845) 777-7585";
const PW = "correct horse battery";
beforeAll(async () => {
  process.env.ADMIN_PHONE = "+18457777585";
  process.env.AUTH_SECRET = "test-secret-that-is-long-enough-123";
  await db.insert(schema.adminUsers).values([
    { name: "Sara", phone: "+18457770101", role: "secretary", active: true, passwordHash: await hashPassword(PW) },
    { name: "Dovid", phone: "+18457770102", role: "delivery", active: true, passwordHash: await hashPassword(PW) },
  ]);
});
afterEach(() => {
  delete process.env.VERCEL_ENV;
  delete process.env.TWILIO_MESSAGING_SERVICE_SID;
});

describe("staff sign-in on the live site", () => {
  it("text codes: 'Not active yet' on the live site until Twilio A2P is approved; nothing is sent or stored", async () => {
    expect(smsLoginActive({ VERCEL_ENV: "production", TWILIO_ACCOUNT_SID: "AC", TWILIO_AUTH_TOKEN: "x" })).toBe(false);
    expect(smsLoginActive({ VERCEL_ENV: "production", TWILIO_ACCOUNT_SID: "AC", TWILIO_AUTH_TOKEN: "x", TWILIO_MESSAGING_SERVICE_SID: "MG" })).toBe(true);
    process.env.VERCEL_ENV = "production";
    expect(await sendLoginCode("(845) 777-0102")).toEqual({ ok: false, message: SMS_LOGIN_NOT_ACTIVE });
    expect(h.sms).toEqual([]);
    expect(await db.select().from(schema.loginCodes)).toEqual([]);
  });

  it("Owner today: email code -> becomes a real account -> sets a password -> signs in with the password", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.RESEND_API_KEY = "re_test";
    process.env.RESEND_API_KEY = "re_test";
    await sendLoginEmailCode(OWNER);
    const code = h.emails.at(-1)!.text.match(/\b(\d{6})\b/)![1];
    expect(await verifyLoginCode(OWNER, code, false, "email")).toEqual({ ok: true, role: "owner" });
    const [owner] = await db.select().from(schema.adminUsers).where(eq(schema.adminUsers.phone, "+18457777585"));
    expect(owner).toMatchObject({ role: "owner", active: true });
    expect((await currentStaff())!.userId).toBe(owner.id);
    expect((await setOwnPassword("", "short")).message).toMatch(/at least 10/);
    expect(await setOwnPassword("", PW)).toMatchObject({ ok: true });
    expect((await setOwnPassword("wrong one here", "another long one")).ok).toBe(false); // changing needs the current password
    h.cookies.clear();
    expect(await passwordLogin(OWNER, PW, false)).toEqual({ ok: true, role: "owner" });
    delete process.env.RESEND_API_KEY;
  });

  it("Secretary today: password (set by the Owner on the Staff page, or by herself under My account)", async () => {
    h.cookies.clear();
    expect(await passwordLogin("(845) 777-0101", PW, false)).toEqual({ ok: true, role: "secretary" });
    expect((await passwordLogin("(845) 777-0101", "wrong password!!", false)).ok).toBe(false);
  });

  it("deep check B2: guesses sent at the same moment all count; the right password is refused once locked", async () => {
    h.cookies.clear();
    await db.update(schema.adminUsers).set({ failedLogins: 0, lockedUntil: null }).where(eq(schema.adminUsers.phone, "+18457770101"));
    await Promise.all(Array.from({ length: 6 }, () => passwordLogin("(845) 777-0101", "wrong password!!", false)));
    const [u] = await db.select().from(schema.adminUsers).where(eq(schema.adminUsers.phone, "+18457770101"));
    expect(u.lockedUntil && u.lockedUntil > new Date()).toBe(true);
    expect((await passwordLogin("(845) 777-0101", PW, false)).ok).toBe(false);
    await db.update(schema.adminUsers).set({ failedLogins: 0, lockedUntil: null }).where(eq(schema.adminUsers.id, u.id));
  });

  it("deep check 06:00 M21: a burst of 8 guesses with the right password last: it never gets in, and every answer after the 5th is the same", async () => {
    h.cookies.clear();
    await db.update(schema.adminUsers).set({ failedLogins: 0, lockedUntil: null }).where(eq(schema.adminUsers.phone, "+18457770101"));
    const tries = [...Array.from({ length: 7 }, () => "wrong password!!"), PW];
    const r = await Promise.all(tries.map((p) => passwordLogin("(845) 777-0101", p, false)));
    expect(r.some((x) => x.ok)).toBe(false);
    const late = r.slice(4).map((x) => ("error" in x ? x.error : ""));
    expect(new Set(late).size).toBe(1);
    expect(late[0]).toContain("Too many tries");
    const [u] = await db.select().from(schema.adminUsers).where(eq(schema.adminUsers.phone, "+18457770101"));
    await db.update(schema.adminUsers).set({ failedLogins: 0, lockedUntil: null }).where(eq(schema.adminUsers.id, u.id));
  }, 30_000);

  it("Delivery: text code only, never a password (refused even if one was stored)", async () => {
    h.cookies.clear();
    expect((await passwordLogin("(845) 777-0102", PW, false)).ok).toBe(false);
    expect(readFileSync("src/app/admin/(app)/staff/actions.ts", "utf8")).toContain("Delivery accounts sign in with a texted code only.");
    const me = readFileSync("src/app/admin/(app)/account/page.tsx", "utf8");
    expect(me).toContain('requireStaff(["owner", "secretary"])');
  });

  it("the sign-in page says plainly what works today", () => {
    const form = readFileSync("src/app/admin/login/LoginForm.tsx", "utf8");
    expect(form).toContain('data-not-active="sms-login"');
    expect(form).toContain('["password", "Password", KeyRound]');
    expect(form).toContain('["email", "Code by email", Mail]');
    expect(form).toContain('["sms", "Code by text", MessageSquareText]');
    expect(form).toContain('data-not-active="email-login"');
    expect(readFileSync("src/app/admin/login/page.tsx", "utf8")).toContain("smsActive={smsLoginActive()}");
  });
});
