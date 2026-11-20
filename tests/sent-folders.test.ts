import { beforeAll, describe, expect, it, vi } from "vitest";

/* Abraham, Nov 20, 2026: Sent holds only emails people wrote; sign-in codes, catalogs we sent and automatic emails
 * have their own places; every sign-in is kept with its sign-out time. In-memory database. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { db, schema } from "@/lib/db";
import { FOLDERS, listSent } from "@/lib/inbox-folders";
import { recordSentEmail } from "@/lib/inbox";
import { codesSent, deviceWords, signInLog } from "@/lib/sign-in-log";

beforeAll(async () => {
  await db.insert(schema.inboxReplies).values({ toAddress: "client@example.com", subject: "Re: Sunday", body: "See you Sunday", sent: true, userId: 1, kind: "sent" });
  await recordSentEmail({ to: "client@example.com", subject: "Your booking is confirmed", body: "x", attachments: [], sent: true, error: null });
  await recordSentEmail({ to: "client@example.com", subject: "Our catalog", body: "x", attachments: [], sent: true, error: null, kind: "catalog" });
  await recordSentEmail({ to: "staff@example.com", subject: "Hup Up Attractions sign-in code: 123456", body: "x", attachments: [], sent: true, error: null, kind: "code" });
});

describe("Sent and the other folders", () => {
  it("Sent shows only emails people wrote; automatic, catalog and code emails each go to their own place", async () => {
    expect((await listSent({})).rows.map((r) => r.subject)).toEqual(["Re: Sunday"]);
    expect((await listSent({ kind: "auto" })).rows.map((r) => r.subject)).toEqual(["Your booking is confirmed"]);
    expect((await listSent({ kind: "catalog" })).rows.map((r) => r.subject)).toEqual(["Our catalog"]);
    expect((await listSent({ kind: "code" })).rows).toHaveLength(1);
  });
  it("the folders: Sign-in codes and Automatic emails after Catalog requests", () => {
    const keys = FOLDERS.map((f) => f.key);
    expect(keys.slice(0, 8)).toEqual(["inbox", "starred", "snoozed", "sent", "drafts", "catalog", "codes", "auto"]);
    expect(FOLDERS.find((f) => f.key === "codes")!.label).toBe("Sign-in codes");
  });
});

describe("sign-in codes and the sign-in log", () => {
  it("each code: who asked, by text or email, used or not; never the code", async () => {
    const [u] = await db.insert(schema.adminUsers).values({ name: "Sarah Secretary", phone: "+18455550150", role: "secretary", active: true }).returning();
    const past = new Date(Date.now() - 3_600_000);
    await db.insert(schema.loginCodes).values([
      { userId: u.id, channel: "sms:+18455550150", codeHash: "h1", expiresAt: past, usedAt: new Date(past.getTime() - 60_000), createdAt: new Date(past.getTime() - 120_000) },
      { userId: u.id, channel: "email:+18455550150", codeHash: "h2", expiresAt: past, createdAt: new Date(past.getTime() - 200_000) },
    ]);
    const codes = await codesSent();
    expect(codes.map((c) => [c.name, c.by, c.status])).toEqual([
      ["Sarah Secretary", "Text", "Used to sign in"],
      ["Sarah Secretary", "Email", "Not used (expired)"],
    ]);
    expect(JSON.stringify(codes)).not.toContain("h1");
  });
  it("sign-in with its sign-out: signed out, signed out by the Owner, timed out, still signed in", async () => {
    const [u] = await db.insert(schema.adminUsers).values({ name: "Dov Driver", phone: "+18455550160", role: "delivery", active: true }).returning();
    const now = new Date();
    const later = new Date(now.getTime() + 3_600_000);
    const earlier = new Date(now.getTime() - 3_600_000);
    await db.insert(schema.signIns).values([
      { userId: u.id, method: "sms_code", tokenHash: "t1", expiresAt: later, signedInAt: new Date(now.getTime() - 4000), signedOutAt: now, endReason: "signed_out" },
      { userId: u.id, method: "password", tokenHash: "t2", expiresAt: later, signedInAt: new Date(now.getTime() - 3000), signedOutAt: now, endReason: "revoked" },
      { userId: u.id, method: "email_code", tokenHash: "t3", expiresAt: earlier, signedInAt: new Date(now.getTime() - 2000) },
      { userId: u.id, method: "google", tokenHash: "t4", expiresAt: later, signedInAt: new Date(now.getTime() - 1000), userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1" },
    ]);
    const log = await signInLog(100, now);
    expect(log.map((r) => [r.how, r.out.words])).toEqual([
      ["Google", "Still signed in"],
      ["Code by email", "Timed out"],
      ["Password", "Signed out by the Owner"],
      ["Code by text", "Signed out"],
    ]);
    expect(log[0].device).toBe("Safari on iPhone");
    expect(deviceWords("Mozilla/5.0 (Windows NT 10.0) AppleWebKit Chrome/120 Safari/537")).toBe("Chrome on Windows");
  });
});
