import { describe, expect, it, vi } from "vitest";

/* Deep check 30 (Nov 27, 2026): the Sent copy of a sign-in code email never shows the code; the weekly backup's Sent
   copy keeps no backup file (all customer data stays only in the Owner's own email). */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { readFileSync } from "node:fs";
import { db, schema } from "@/lib/db";
import { recordSentEmail } from "@/lib/inbox";

describe("Sent copies", () => {
  it("sign-in code hidden in subject and body", async () => {
    const r = await recordSentEmail({ to: "staff@example.com", subject: "Hup Up Attractions sign-in code: 482913", body: "Hup Up Attractions staff sign-in code: 482913\n\nIt expires in 10 minutes.", attachments: [], sent: true, error: null, kind: "code" });
    expect(r.subject).not.toContain("482913");
    expect(r.body).not.toContain("482913");
    expect(r.body).toContain("10 minutes");
    expect(r.kind).toBe("code");
  });
  it("weekly backup: Sent copy without the file", async () => {
    const r = await recordSentEmail({ to: "owner@example.com", subject: "Hup Up Attractions: weekly backup", body: "Your weekly backup", attachments: [{ filename: "hupup-backup-2026-11-29.json.gz", content: Buffer.from("secret customer data").toString("base64") }], sent: true, error: null, kind: "backup" });
    expect(r.body).toContain("is not kept here");
    expect(await db.select().from(schema.inboxFiles)).toHaveLength(0);
    expect(readFileSync("src/app/api/cron/release-holds/route.ts", "utf8")).toContain('{ kind: "backup" }');
  });
});

describe("deep check C1: email copies never fill the free database", () => {
  it("a catalog email's Sent copy is kept without the catalog PDF (the same file every time)", async () => {
    const before = (await db.select().from(schema.inboxFiles)).length;
    const r = await recordSentEmail({ to: "sara@example.com", subject: "Hup Up Attractions catalog", body: "Here is our catalog", attachments: [{ filename: "Hup-Up-Catalog.pdf", content: Buffer.from("%PDF-1.7 big").toString("base64") }], sent: true, error: null, kind: "catalog" });
    expect(r.body).toContain("Hup-Up-Catalog.pdf");
    expect((await db.select().from(schema.inboxFiles)).length).toBe(before);
  });
  it("past the 800 MB stop, an attachment is listed but not kept", () => {
    const src = readFileSync("src/lib/inbox.ts", "utf8").split("async function storeFile")[1].split("\n}\n")[0];
    expect(src).toContain("(await databaseBytes()) + input.data.length > ATTACHMENT_STORAGE_STOP_BYTES");
  });
});

describe("deep check 0600 M36 + M65", () => {
  it("M65: the API Keys code email is sent as a code email (its Sent copy hides the code)", () => {
    expect(readFileSync("src/lib/api-keys.ts", "utf8")).toMatch(/API Keys code: \$\{code\}`[\s\S]{0,300}\{ kind: "code" \}\);/);
  });
  it("M36: the backup file is named by the New York date", async () => {
    const { backupFileName } = await import("@/lib/backup");
    expect(backupFileName(new Date("2026-11-29T03:30:00Z"))).toBe("hupup-backup-2026-11-28.json.gz"); // 10:30 PM Saturday in New York
  });
});
