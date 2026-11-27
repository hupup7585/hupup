import { beforeEach, describe, expect, it, vi } from "vitest";

/* Extra check I (Nov 27, 2026, phone helpers outside flow.ts). */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
const emails: string[] = [];
vi.mock("@/lib/notify", () => ({ sendEmail: async (_to: string, subject: string) => (emails.push(subject), { sent: true }), sendSms: async () => ({ sent: true }) }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { checkBoxPin } from "@/lib/vm-boxes";

const box = async () => {
  const [b] = await db.insert(schema.voicemailBoxes).values({ name: "Owner", boxNumber: String(100 + Math.floor(Math.random() * 1e6)) }).returning();
  return b;
};
const row = async (id: number) => (await db.select().from(schema.voicemailBoxes).where(eq(schema.voicemailBoxes.id, id)))[0];

describe("I1: the voicemail box password lockout holds with several calls at once", () => {
  beforeEach(() => {
    emails.length = 0;
    process.env.ADMIN_EMAIL = "owner@example.com";
  });
  it("five wrong guesses at the same moment (each call holding the same old copy of the box) lock the box", async () => {
    const b = await box();
    const results = await Promise.all(["1111", "2222", "3333", "4444", "5555"].map((p) => checkBoxPin(b, p)));
    expect(results.filter((r) => r === "wrong")).toHaveLength(2);
    expect(results.filter((r) => r === "locked")).toHaveLength(3);
    expect((await row(b.id)).lockedUntil).not.toBeNull();
    // the right password is refused while locked, even from a call that read the box before the lock
    expect(await checkBoxPin(b, "1234")).toBe("locked");
  });
  it("deep check 06:00 M20: a burst of 10 guesses with the right password last never opens the box", async () => {
    const b = await box();
    const results = await Promise.all(["1", "2", "3", "4", "5", "6", "7", "8", "9", "1234"].map((p) => checkBoxPin(b, p)));
    expect(results).not.toContain("ok");
    expect(results.at(-1)).toBe("locked");
  });
  it("the Owner gets one lock email, not one per call", async () => {
    const b = await box();
    await Promise.all(["1", "2", "3", "4", "5", "6"].map((p) => checkBoxPin(b, p)));
    expect(emails.filter((s) => s.includes("locked"))).toHaveLength(1);
  });
  it("single calls work as before: 2 wrong, then right resets; 3 wrong locks; after 15 minutes the count starts again", async () => {
    const b = await box();
    expect(await checkBoxPin(b, "0000")).toBe("wrong");
    expect(await checkBoxPin(b, "0000")).toBe("wrong");
    expect(await checkBoxPin(b, "1234")).toBe("ok");
    expect((await row(b.id)).wrongTries).toBe(0);
    for (let i = 0; i < 2; i++) expect(await checkBoxPin(b, "0000")).toBe("wrong");
    expect(await checkBoxPin(b, "0000")).toBe("locked");
    const later = new Date(Date.now() + 16 * 60_000);
    expect(await checkBoxPin(b, "0000", later)).toBe("wrong");
    expect((await row(b.id)).wrongTries).toBe(1);
    expect(await checkBoxPin(b, "1234", later)).toBe("ok");
  });
});
