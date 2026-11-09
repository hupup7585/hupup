import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/* Owner "Send code by email" (Abraham K). In-memory database; emails are captured, nothing is sent. */
const h = vi.hoisted(() => ({ emails: [] as { to: string; subject: string; text: string }[], emailWorks: true, cookies: new Map<string, string>() }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "1.2.3.4", "user-agent": "UA" }),
  cookies: async () => ({ set: (k: string, v: string) => h.cookies.set(k, v), get: (k: string) => (h.cookies.has(k) ? { value: h.cookies.get(k) } : undefined), delete: (k: string) => h.cookies.delete(k) }),
}));
vi.mock("@/lib/notify", () => ({
  sendEmail: async (to: string, subject: string, text: string) => (h.emailWorks ? (h.emails.push({ to, subject, text }), { sent: true }) : { sent: false, error: "Email (Resend) is not configured" }),
  sendSms: async () => ({ sent: true }),
}));

import { db, schema } from "@/lib/db";
import { EMAIL_NOT_SET_UP, OWNER_CODE_EMAIL, sendLoginEmailCode, verifyLoginCode } from "@/lib/auth";

const OWNER = "(845) 777-7585";
const codeFrom = () => h.emails.at(-1)!.text.match(/\b(\d{6})\b/)![1];

beforeAll(async () => {
  process.env.ADMIN_PHONE = "+18457777585";
  process.env.AUTH_SECRET = "test-secret-that-is-long-enough-123";
  await db.insert(schema.adminUsers).values({ name: "Sara", phone: "+18455550188", role: "secretary", active: true });
});
beforeEach(async () => {
  h.emails.length = 0;
  h.emailWorks = true;
  await db.delete(schema.loginCodes);
});

describe("Owner: Send code by email", () => {
  it("emails a 6-digit code to the business Gmail, and it signs the Owner in", async () => {
    expect(OWNER_CODE_EMAIL).toBe("hupupattractions@gmail.com");
    const r = await sendLoginEmailCode(OWNER);
    expect(r.ok).toBe(true);
    expect(h.emails).toHaveLength(1);
    expect(h.emails[0].to).toBe("hupupattractions@gmail.com");
    expect(h.emails[0].text).toContain("It expires in 10 minutes.");
    const [row] = await db.select().from(schema.loginCodes);
    expect(row.channel).toBe("email:+18457777585");
    expect(Math.round((row.expiresAt.getTime() - Date.now()) / 60_000)).toBe(10);
    expect(await verifyLoginCode(OWNER, codeFrom(), false, "email")).toEqual({ ok: true, role: "owner" });
  });

  it("other staff: the code goes to their own saved email; no saved email or Delivery = same generic reply and no email", async () => {
    const r = await sendLoginEmailCode("(845) 555-0188"); // Sara has no saved email
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/If that number has a staff account with a saved email/);
    expect(h.emails).toHaveLength(0);
    expect(await verifyLoginCode("(845) 555-0188", "123456", false, "email")).toMatchObject({ ok: false });
    await db.insert(schema.adminUsers).values({ name: "Rivky", phone: "+18455550199", role: "secretary", active: true, email: "rivky@example.org" });
    await sendLoginEmailCode("(845) 555-0199");
    expect(h.emails.at(-1)!.to).toBe("rivky@example.org");
    expect(await verifyLoginCode("(845) 555-0199", codeFrom(), false, "email")).toEqual({ ok: true, role: "secretary" });
    h.emails.length = 0;
    await db.insert(schema.adminUsers).values({ name: "Dovid", phone: "+18455550177", role: "delivery", active: true, email: "dovid@example.org" });
    expect((await sendLoginEmailCode("(845) 555-0177")).message).toMatch(/If that number has a staff account/);
    expect(h.emails).toHaveLength(0); // Delivery: text code only
  });

  it("5 wrong tries and the code stops working (same as the text code)", async () => {
    await sendLoginEmailCode(OWNER);
    const good = codeFrom();
    const bad = good === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect((await verifyLoginCode(OWNER, bad, false, "email")).ok).toBe(false);
    expect(await verifyLoginCode(OWNER, good, false, "email")).toMatchObject({ ok: false, error: "Too many attempts. Request a new code." });
  });

  it("at most 5 codes in 10 minutes; a text code can't be used as an email code", async () => {
    for (let i = 0; i < 5; i++) expect((await sendLoginEmailCode(OWNER)).ok).toBe(true);
    expect((await sendLoginEmailCode(OWNER)).message).toMatch(/Too many codes/);
    expect(await verifyLoginCode(OWNER, codeFrom(), false, "sms")).toMatchObject({ ok: false }); // wrong channel
  });

  it("no email sender connected yet: a clear message, and no code is stored", async () => {
    h.emailWorks = false;
    expect(await sendLoginEmailCode(OWNER)).toEqual({ ok: false, message: EMAIL_NOT_SET_UP });
    expect(await db.select().from(schema.loginCodes)).toHaveLength(0);
  });
});
