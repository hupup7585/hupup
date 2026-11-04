import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dbWriteSkipReason } from "../scripts/db-guard";

describe("preview builds never change the shared database", () => {
  it("skips on Vercel preview builds", () => {
    expect(dbWriteSkipReason({ VERCEL_ENV: "preview" })).toMatch(/preview build: skipping/);
  });
  it("runs on production builds and locally", () => {
    expect(dbWriteSkipReason({ VERCEL_ENV: "production" })).toBeNull();
    expect(dbWriteSkipReason({})).toBeNull();
  });
  it("can be explicitly allowed for a preview with its own database", () => {
    expect(dbWriteSkipReason({ VERCEL_ENV: "preview", ALLOW_PREVIEW_DB_WRITES: "1" })).toBeNull();
  });
  it("migrate and seed scripts check the guard before connecting", () => {
    for (const f of ["scripts/migrate.ts", "scripts/seed.ts"]) {
      const s = readFileSync(f, "utf8");
      const guard = s.indexOf("dbWriteSkipReason()");
      expect(guard, f).toBeGreaterThan(-1);
      expect(guard, f).toBeLessThan(s.search(/new Pool|getDb\(\)/));
    }
  });
});
