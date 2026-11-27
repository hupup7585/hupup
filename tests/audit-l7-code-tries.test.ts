import { beforeAll, describe, expect, it, vi } from "vitest";

/* Code audit L7 (Nov 24, 2026): the 5-tries limit on sign-in codes holds even when guesses arrive at the same moment. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "1.2.3.4", "user-agent": "UA" }), cookies: async () => ({ set: () => undefined, get: () => undefined, delete: () => undefined }) }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error(`REDIRECT ${u}`); } }));
const sms = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/notify", () => ({ sendEmail: async () => ({ sent: true }), sendSms: async (_to: string, text: string) => (sms.push(text), { sent: true }) }));

import { db, schema } from "@/lib/db";
import { sendLoginCode, verifyLoginCode } from "@/lib/auth";

const SARA = "(845) 777-0101";
beforeAll(async () => {
  process.env.AUTH_SECRET = "test-secret-that-is-long-enough-123";
  await db.insert(schema.adminUsers).values({ name: "Sara", phone: "+18457770101", role: "secretary", active: true });
});

describe("sign-in code tries", () => {
  it("10 wrong guesses at once: at most 5 are checked, and the right code no longer works after", async () => {
    await sendLoginCode(SARA);
    const code = sms.at(-1)?.match(/\b(\d{6})\b/)?.[1];
    expect(code).toBeTruthy();
    const wrong = code === "000000" ? "111111" : "000000";
    const results = await Promise.all(Array.from({ length: 10 }, () => verifyLoginCode(SARA, wrong, false)));
    expect(results.filter((r) => r.error === "Incorrect code. Try again.").length).toBeLessThanOrEqual(5);
    const [row] = await db.select().from(schema.loginCodes);
    expect(row.attempts).toBe(5);
    expect((await verifyLoginCode(SARA, code!, false)).error).toBe("Too many attempts. Request a new code.");
  });
});
