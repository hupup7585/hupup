import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ERROR_PAGE_DRAFT, ERROR_PAGE_LIVE_APPROVED, brandedErrorPageShown } from "@/lib/error-page-copy";

describe("website error page (W1, wording waiting for Abraham)", () => {
  it("is preview only until Abraham approves the words; the live site keeps Next's standard screen", () => {
    expect(ERROR_PAGE_LIVE_APPROVED).toBe(false);
    expect(brandedErrorPageShown("production")).toBe(false);
    expect(brandedErrorPageShown("preview")).toBe(true);
    expect(brandedErrorPageShown("")).toBe(true);
  });
  it("draft words are listed for Abraham, with the public number", () => {
    expect(ERROR_PAGE_DRAFT.body).toContain("(845) 777-7585");
    const list = readFileSync("docs/website-open-decisions.md", "utf8");
    for (const w of Object.values(ERROR_PAGE_DRAFT)) expect(list).toContain(w);
  });
  it("passes the error on (unchanged) on the live site and on Admin pages; one H1; logo has alt text", () => {
    const src = readFileSync("src/app/error.tsx", "utf8");
    expect(src).toContain('if (!brandedErrorPageShown() || path.startsWith("/admin")) throw error;');
    expect(src.match(/<h1/g)).toHaveLength(1);
    expect(src).toContain('alt="Hup Up Attractions"');
    expect(readFileSync("next.config.ts", "utf8")).toContain("HUP_SITE_ENV: process.env.VERCEL_ENV");
  });
});
