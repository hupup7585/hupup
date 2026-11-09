import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/*
 * The live outage (Nov 9): migration 0016 was dated earlier than 0015, so the migrator on the live database skipped
 * it and /admin crashed on the missing call_events table. These checks keep that from happening again.
 */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { safeSection, sectionReason } from "@/lib/safe-section";
import { journeyStats } from "@/lib/call-journey";

const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")).entries as { idx: number; when: number; tag: string }[];

describe("database updates (migrations)", () => {
  it("every migration after 0016 is dated later than all the ones before it (so none is skipped)", () => {
    for (const e of journal.filter((x) => x.idx > 16)) {
      const before = journal.filter((x) => x.idx < e.idx).map((x) => x.when);
      expect(e.when, e.tag).toBeGreaterThan(Math.max(...before));
    }
  });

  it("0023 restores call_events only if missing, and never drops or deletes anything", () => {
    const m = readFileSync("drizzle/0023_restore_call_events.sql", "utf8");
    expect(m).toContain('CREATE TABLE IF NOT EXISTS "call_events"');
    expect(m).toContain('CREATE INDEX IF NOT EXISTS "call_events_call_idx"');
    expect(m).not.toMatch(/\bDROP\b|\bDELETE\b|\bTRUNCATE\b/i);
    expect(journal.map((e) => e.tag)).toContain("0023_restore_call_events");
  });
});

describe("a missing table shows 'Not active yet' instead of crashing the page", () => {
  it("the dashboard section reports which table is missing; the rest of the page still loads", async () => {
    await db.execute(sql`ALTER TABLE call_events RENAME TO call_events_hidden_for_test`);
    const r = await safeSection("caller journeys", journeyStats(30));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("the call_events table isn't in the database yet (a database update hasn't run)");
    await db.execute(sql`ALTER TABLE call_events_hidden_for_test RENAME TO call_events`);
    expect((await safeSection("caller journeys", journeyStats(30))).ok).toBe(true);
    expect(sectionReason(new Error("boom"))).toBe("this section couldn't load right now");
    const page = readFileSync("src/app/admin/(app)/page.tsx", "utf8");
    expect(page).toContain('safeSection("call analytics"');
    expect(page).toContain('<SectionNotActive title="What callers ask for"');
    expect(readFileSync("src/app/admin/(app)/calls/page.tsx", "utf8")).toContain('safeSection("call journeys"');
  });
});
