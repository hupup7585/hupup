import { beforeAll, describe, expect, it, vi } from "vitest";

/* Abraham, Nov 24, 2026, 11:22 AM: a phone search finds the number however it is typed. In-memory database. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { db, schema } from "@/lib/db";
import { cellMatches, phoneQueryDigits } from "@/lib/phone-search";
import { recentCalls } from "@/lib/admin-queries";

const TYPED = ["8457", "(845) 7", "845-7", "845 7", "845.7", "+1 845 7", "(845)7", "1 845-783-6823", "18457836823"];

describe("phone search by digits", () => {
  it("every way of typing finds (845) 783-6823 in a table cell, stored any way", () => {
    for (const stored of ["(845) 783-6823", "845-783-6823", "+18457836823", "8457836823"]) {
      for (const q of TYPED) expect(cellMatches(stored, q), `${stored} / ${q}`).toBe(true);
    }
  });
  it("does not match a different number, and names still search as text", () => {
    expect(cellMatches("(845) 783-6823", "8458")).toBe(false);
    expect(cellMatches("Klein", "kle")).toBe(true);
    expect(phoneQueryDigits("Klein 845")).toBeNull();
  });
  it("a leading 1 or +1 is ignored", () => {
    expect(phoneQueryDigits("+1 845 7")).toBe("8457");
    expect(phoneQueryDigits("1-845-7")).toBe("8457");
    expect(phoneQueryDigits("18457836823")).toBe("8457836823");
    expect(phoneQueryDigits("1212")).toBe("1212"); // digits from the middle of a number stay as typed
  });
});

describe("Call log search (database)", () => {
  beforeAll(async () => {
    await db.insert(schema.callSessions).values([
      { callSid: "CAsearch1", fromNumber: "+18457836823", status: "completed", outcome: "browsing", data: {} },
      { callSid: "CAsearch2", fromNumber: "845-999-1111", status: "completed", outcome: "browsing", data: { name: "Sara Klein" } },
    ] as never);
  });
  it("finds the call by any way of typing the number, stored with or without dashes", async () => {
    for (const q of TYPED) expect((await recentCalls(100, q)).map((c) => c.call_sid), q).toEqual(["CAsearch1"]);
    expect((await recentCalls(100, "(845) 999")).map((c) => c.call_sid)).toEqual(["CAsearch2"]);
    expect((await recentCalls(100, "klein")).map((c) => c.call_sid)).toEqual(["CAsearch2"]);
  });
});

describe("the Directory sheet uses it for its search and column filters", () => {
  it("source check", async () => {
    const { readFileSync } = await import("node:fs");
    const s = readFileSync("src/app/admin/(app)/customers/directory/DirectorySheet.tsx", "utf8");
    expect(s).toContain("cellMatches(r[c.key], q)");
    expect(s).toContain("cellMatches(r[k], v)");
  });
});
