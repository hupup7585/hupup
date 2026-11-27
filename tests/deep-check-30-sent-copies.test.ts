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
