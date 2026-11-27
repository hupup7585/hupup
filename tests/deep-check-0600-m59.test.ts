import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/*
 * Deep check 06:00, M59 (Nov 27, 2026): migration 0075 was edited 6 minutes after its first commit (7290dc9 -> 6418e76)
 * to add phonepay_attempts.unclear_refs. A database that ran the first version recorded 0075 as done and never got the
 * column; every full read of phonepay_attempts (the phone card tries) then fails. 0105 adds it again (IF NOT EXISTS).
 * These tests rebuild that live state in an in-memory Postgres with the real migrations and the real payment code.
 */
const mem = vi.hoisted(() => ({ client: null as unknown as import("@electric-sql/pglite").PGlite }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  mem.client = m.client;
  return { db: m.db, schema: m.schema };
});

import { db } from "@/lib/db";
import { migrate } from "drizzle-orm/pglite/migrator";
import { voidUnclearAfterPaid } from "@/lib/sola-phonepay";

const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")).entries as { idx: number; when: number; tag: string }[];
const hasColumn = async () =>
  (await mem.client.query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'phonepay_attempts' AND column_name = 'unclear_refs'`)).rows.length === 1;

describe("deep check M59: phonepay_attempts.unclear_refs on a database that ran the first 0075", () => {
  it("0105 adds the column only if missing, is last in the journal and dated after 0104, and touches no data", () => {
    const m = readFileSync("drizzle/0105_phonepay_unclear_refs.sql", "utf8");
    expect(m).toContain('ALTER TABLE "phonepay_attempts" ADD COLUMN IF NOT EXISTS "unclear_refs" text;');
    expect(m).not.toMatch(/\bDROP\b|\bDELETE\b|\bTRUNCATE\b|\bUPDATE\b/i);
    const e = journal.find((x) => x.tag === "0105_phonepay_unclear_refs")!;
    expect(e.idx).toBe(105);
    expect(e.when).toBeGreaterThan(journal.find((x) => x.tag === "0104_paid_notice_claim")!.when);
  });

  it("without the column the phone payment code fails; after the deploy's migration run it works and nothing else changes", async () => {
    expect(await hasColumn()).toBe(true);
    // an Owner custom charge row (no order), so the table has data that must survive
    await mem.client.query(`INSERT INTO phonepay_attempts (kind, call_sid, amount_cents) VALUES ('custom', 'CAm59', 1234)`);
    const before = (await mem.client.query(`SELECT count(*)::int AS n FROM phonepay_attempts`)).rows[0] as { n: number };

    // The live state M59 describes: the column never added, and 0105 not run yet
    await mem.client.query(`ALTER TABLE phonepay_attempts DROP COLUMN unclear_refs`);
    const last = (await mem.client.query(`SELECT max(created_at)::text AS w FROM drizzle.__drizzle_migrations`)).rows[0] as { w: string };
    expect(Number(last.w)).toBe(journal.find((x) => x.tag === "0105_phonepay_unclear_refs")!.when);
    await mem.client.query(`DELETE FROM drizzle.__drizzle_migrations WHERE created_at = ${last.w}`);
    const mail = vi.fn(async () => {});
    await expect(voidUnclearAfterPaid(4242, "R1", mail)).rejects.toThrow(/unclear_refs/);

    // The next deploy runs the migrations (scripts/migrate.ts): only 0105 is new, and it puts the column back
    await migrate(db as never, { migrationsFolder: "./drizzle" });
    expect(await hasColumn()).toBe(true);
    await expect(voidUnclearAfterPaid(4242, "R1", mail)).resolves.toBeUndefined();
    expect(mail).not.toHaveBeenCalled();
    const after = (await mem.client.query(`SELECT count(*)::int AS n FROM phonepay_attempts`)).rows[0] as { n: number };
    expect(after.n).toBe(before.n);

    // Running it again (every later deploy) changes nothing
    await migrate(db as never, { migrationsFolder: "./drizzle" });
    expect(await hasColumn()).toBe(true);
  });

  it("the skipped-update warning knows 0075 can carry the first version's fingerprint (covered by 0105)", () => {
    const s = readFileSync("scripts/migrate.ts", "utf8");
    expect(s).toMatch(/KNOWN_EDITED = new Set\(\["0016_call_events", "0075_phonepay_limits"\]\)/);
    expect(s).toContain("!KNOWN_EDITED.has(e.tag)");
  });
});
