import { describe, expect, it, vi } from "vitest";

/* Deep check 17 (Nov 27, 2026), Inbox part: a scheduled email is sent once even when two scheduler runs overlap. */
const h = vi.hoisted(() => ({ emails: [] as string[] }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/notify", async (orig) => ({
  ...(await orig<typeof import("@/lib/notify")>()),
  sendEmail: async (to: string) => (await new Promise((r) => setTimeout(r, 20)), h.emails.push(to), { sent: true, id: "x" }),
  sendSms: async () => ({ sent: false }),
}));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { sendScheduledEmails } from "@/lib/inbox";

describe("scheduled Inbox emails", () => {
  it("two runs at once: sent once, marked sent", async () => {
    const [x] = await db.insert(schema.inboxDrafts).values({ toAddress: "customer@example.com", subject: "Hello", body: "Hi", sendAt: new Date(Date.now() - 60_000) }).returning();
    await Promise.all([sendScheduledEmails(), sendScheduledEmails()]);
    expect(h.emails).toEqual(["customer@example.com"]);
    const [after] = await db.select().from(schema.inboxDrafts).where(eq(schema.inboxDrafts.id, x.id));
    expect(after.sentReplyId).not.toBeNull();
    expect(after.sendError).toBeNull();
    await sendScheduledEmails();
    expect(h.emails).toHaveLength(1);
  });
});
