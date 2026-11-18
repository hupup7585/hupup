import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/* One solid underline under links, no gaps under @ or p (Abraham, Nov 18, 2026). */
describe("solid underlines", () => {
  it("site-wide (inherited from the page), and on the yellow catalog email link itself", () => {
    expect(readFileSync("src/app/globals.css", "utf8")).toMatch(/html \{\s*text-decoration-skip-ink: none;/);
    expect(readFileSync("src/app/page.tsx", "utf8")).toContain("decoration-hu-yellow decoration-[3px] underline-offset-4 [text-decoration-skip-ink:none]");
  });
});
