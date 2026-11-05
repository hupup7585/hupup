import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/* Next.js only allows async functions to be exported from "use server" files; anything else breaks every page. */
describe('"use server" files export only async functions (and types)', () => {
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(path.join(d, f)).isDirectory() ? walk(path.join(d, f)) : [path.join(d, f)]));
  const files = walk("src").filter((f) => /\.(ts|tsx)$/.test(f) && /^\s*["']use server["']/.test(readFileSync(f, "utf8")));
  it("finds the server-action files", () => expect(files.length).toBeGreaterThan(5));
  for (const f of files) {
    it(f, () => {
      const bad = readFileSync(f, "utf8")
        .split("\n")
        .filter((l) => /^export\s+(const|let|var|class|function(?!\s*\*)|default)/.test(l) && !/^export\s+async\s+function/.test(l));
      expect(bad).toEqual([]);
    });
  }
});
