import { beforeEach, describe, expect, it, vi } from "vitest";
import { gunzipSync } from "node:zlib";

/* Plan step 3 (Abraham, Nov 15, 2026): jobs never fail silently; full backups without any secrets. */
const h = vi.hoisted(() => ({ emails: [] as { to: string; subject: string; text: string }[] }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/notify", async (orig) => ({ ...(await orig<typeof import("@/lib/notify")>()), sendEmail: async (to: string, subject: string, text: string) => (h.emails.push({ to, subject, text }), { sent: true }) }));

import { readFileSync } from "node:fs";
import { db, schema } from "@/lib/db";
import { recentJobRuns, runJob } from "@/lib/jobs";
import { buildBackup } from "@/lib/backup";

beforeEach(() => {
  process.env.ADMIN_EMAIL = "owner@example.com";
  h.emails = [];
});

describe("daily jobs", () => {
  it("a job that works is logged once", async () => {
    expect(await runJob("ok job", async () => ({ n: 2 }), { waitMs: 1 })).toEqual({ n: 2 });
    const [r] = await recentJobRuns(1);
    expect(r).toMatchObject({ name: "ok job", ok: true, attempts: 1 });
  });
  it("a job that fails once is tried again and works", async () => {
    let n = 0;
    await runJob("flaky job", async () => { if (++n < 2) throw new Error("network blip"); return "fine"; }, { waitMs: 1 });
    const [r] = await recentJobRuns(1);
    expect(r).toMatchObject({ ok: true, attempts: 2, error: "network blip" });
    expect(h.emails).toEqual([]);
  });
  it("a job that keeps failing is tried 3 times, marked failed, and the Owner is emailed", async () => {
    expect(await runJob("broken job", async () => { throw new Error("database down"); }, { waitMs: 1 })).toBeNull();
    const [r] = await recentJobRuns(1);
    expect(r).toMatchObject({ ok: false, attempts: 3, error: "database down" });
    expect(h.emails[0]).toMatchObject({ to: "owner@example.com", subject: 'Hup Up Attractions: the job "broken job" failed' });
  });
});

describe("backups", () => {
  it("has the business data and never keys, passwords, codes or sessions", async () => {
    await db.insert(schema.customers).values({ name: "Backup Customer", phone: "+18455550188" });
    await db.insert(schema.adminUsers).values({ name: "Owner", role: "owner", phone: "+18455550189", passwordHash: "$2a$12$secretsecretsecret" });
    const b = await buildBackup();
    const json = gunzipSync(b.gz).toString("utf8");
    const data = JSON.parse(json);
    expect(data.business).toBe("Hup Up Attractions");
    expect(json).toContain("Backup Customer");
    expect(json).not.toContain("secretsecretsecret");
    for (const t of ["api_keys", "admin_sessions", "login_codes"]) expect(data.tables[t]).toBeUndefined();
    expect(data.tables.orders).toBeDefined();
  });
  it("Owner-only download, the weekly email in the daily job, a health check, and both on System status", () => {
    expect(readFileSync("src/app/api/admin/backup/route.ts", "utf8")).toContain('staff.role !== "owner"');
    const cron = readFileSync("src/app/api/cron/release-holds/route.ts", "utf8");
    expect(cron).toContain('runJob("Weekly backup by email"');
    expect(cron).toContain('runJob("Release ended holds"');
    expect(readFileSync("src/app/api/health/route.ts", "utf8")).toContain("SELECT 1");
    const status = readFileSync("src/app/admin/(app)/status/page.tsx", "utf8");
    expect(status).toContain("data-backup");
    expect(status).toContain("data-job-runs");
  });
});
