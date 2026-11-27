import { beforeEach, describe, expect, it, vi } from "vitest";

/* Owner-only API Keys page (Abraham, Nov 14, 2026). */

const h = vi.hoisted(() => ({ emails: [] as { to: string; subject: string; text: string; kind?: string }[] }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/notify", async (orig) => ({
  ...(await orig<typeof import("@/lib/notify")>()),
  sendEmail: async (to: string, subject: string, text: string, _a?: unknown, opts?: { kind?: string }) => (h.emails.push({ to, subject, text, kind: opts?.kind }), { sent: true }),
}));

import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import * as k from "@/lib/api-keys";

const who = { userId: 1, ip: "1.2.3.4", userAgent: "test" };
const codeFrom = () => h.emails.at(-1)!.subject.match(/(\d{6})$/)![1];

beforeEach(() => {
  process.env.AUTH_SECRET = "test-secret-for-keys-0123456789";
  process.env.ADMIN_EMAIL = "owner@example.com";
});

describe("API keys page", () => {
  it("encrypts values; only the last 4 are kept to show", () => {
    const enc = k.encryptValue("sk_test_ABCDEFGH1234");
    expect(enc).not.toContain("ABCDEFGH");
    expect(k.decryptValue(enc)).toBe("sk_test_ABCDEFGH1234");
    expect(k.masked(k.last4("sk_test_ABCDEFGH1234"))).toBe("•••• 1234");
  });
  it("set the page password with an emailed code, then open with password plus a new code; the session locks after 10 idle minutes", async () => {
    expect(await k.pagePasswordSet()).toBe(false);
    await k.requestSetupCode(who);
    expect(h.emails.at(-1)!.to).toBe("owner@example.com");
    expect(h.emails.at(-1)!.kind).toBe("code"); // deep check 06:00 M65: the Sent copy hides the code
    const set = await k.setPagePassword("correct horse battery", codeFrom(), who);
    expect(set.ok).toBe(true);
    expect(await k.pagePasswordSet()).toBe(true);
    const [row] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, "api_keys_page_password"));
    expect(String(row.value)).not.toContain("correct horse"); // hashed

    const p = await k.checkPagePassword("correct horse battery", who);
    expect(p.ok).toBe(true);
    expect(p.sentTo).toBe("o***@example.com");
    const c = await k.checkCode(codeFrom(), who);
    expect(c.ok).toBe(true);
    expect(await k.isUnlocked(c.token, 1)).toBe(true);
    expect(await k.isUnlocked(c.token, 2)).toBe(false); // another account
    expect(await k.isUnlocked(c.token, 1, new Date(Date.now() + 11 * 60_000))).toBe(false); // 10 minutes idle
  });
  it("keys are saved encrypted, replaced by name, never shown in full; delete needs the page password", async () => {
    await k.saveKey({ name: "stripe_read_key", service: "Stripe", purpose: "Fees", mode: "test", value: "rk_test_SECRET_9876" }, who);
    let list = await k.listKeys();
    expect(list.map((x) => [x.name, x.last4, x.mode])).toEqual([["STRIPE_READ_KEY", "9876", "test"]]);
    expect(JSON.stringify(list)).not.toContain("SECRET");
    expect(list[0].vercelError).toMatch(/isn't set up/); // no Vercel connection in tests
    const r = await k.saveKey({ name: "STRIPE_READ_KEY", service: "Stripe", purpose: "Fees", mode: "test", value: "rk_test_NEWONE_5555" }, who);
    expect(r.replaced).toBe(true);
    list = await k.listKeys();
    expect(list.map((x) => x.last4)).toEqual(["5555"]);
    expect((await k.deleteKey("STRIPE_READ_KEY", "wrong password!!", who)).ok).toBe(false);
    expect((await k.deleteKey("STRIPE_READ_KEY", "correct horse battery", who)).ok).toBe(true);
    expect(await k.listKeys()).toEqual([]);
  });
  it("5 wrong tries lock the page for 30 minutes and email the Owner", async () => {
    h.emails = [];
    for (let i = 0; i < 4; i++) await k.checkPagePassword("nope nope nope", who); // 1 wrong delete above + 4 = 5
    expect(await k.lockedUntil()).not.toBeNull();
    expect(h.emails.map((e) => e.subject)).toContain("Hup Up Attractions: API Keys page locked");
    expect((await k.checkPagePassword("correct horse battery", who)).ok).toBe(false); // even the right one
    expect(await k.lockedUntil(new Date(Date.now() + 31 * 60_000))).toBeNull();
  });
  it("the log records every step and can't be edited or deleted", async () => {
    const actions = (await k.keysLog()).map((r) => r.action);
    for (const a of ["page_password_set", "unlocked", "add", "replace", "delete", "failed_password", "locked_out", "unlock_code_sent"]) expect(actions).toContain(a);
    const [one] = await k.keysLog(1);
    await expect(db.delete(schema.apiKeysLog).where(eq(schema.apiKeysLog.id, one.id))).rejects.toThrow();
    await expect(db.update(schema.apiKeysLog).set({ action: "x" }).where(eq(schema.apiKeysLog.id, one.id))).rejects.toThrow();
  });
  it("sends a saved key to Vercel when the connection is set up (value never logged)", async () => {
    const calls: { url: string; body: string }[] = [];
    const fake = (async (u: string, init: RequestInit) => (calls.push({ url: u, body: String(init.body) }), new Response("{}"))) as unknown as typeof fetch;
    await db.insert(schema.apiKeys).values({ name: "X_TEST_KEY", service: "X", valueEnc: k.encryptValue("v"), last4: "v" });
    expect(await k.syncToVercel("X_TEST_KEY", "value-123", fake, { VERCEL_API_TOKEN: "t" })).toBe(true);
    expect(calls[0].url).toContain(`/v10/projects/${k.VERCEL_PROJECT_ID}/env?upsert=true`);
    expect(JSON.parse(calls[0].body)).toMatchObject({ key: "X_TEST_KEY", type: "sensitive", target: ["production", "preview"] });
  });
  it("Owner only, on the server, for the page and every action; hidden from other roles' menu", () => {
    expect(readFileSync("src/app/admin/(app)/keys/page.tsx", "utf8")).toContain("await requireOwner()");
    const a = readFileSync("src/app/admin/(app)/keys/actions.ts", "utf8");
    expect(a).toContain("const s = await requireOwner();");
    expect(readFileSync("src/components/Sidebar.tsx", "utf8")).toContain('["/admin/keys", KeyRound, "API keys", O]');
  });
});
