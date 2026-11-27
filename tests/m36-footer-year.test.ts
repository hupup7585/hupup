import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { footerYear } from "@/components/site/SiteFooterView";

/* Deep check 0600 M36 (website part): the footer's copyright year is the New York year, never the UTC one. */
describe("website footer year", () => {
  it("Dec 31, 2026 at 9 PM in New York (Jan 1 in UTC) still shows 2026; just after midnight New York time shows 2027", () => {
    expect(footerYear(new Date("2027-01-01T02:00:00Z"))).toBe(2026);
    expect(footerYear(new Date("2027-01-01T05:01:00Z"))).toBe(2027);
    expect(footerYear(new Date("2026-07-04T12:00:00Z"))).toBe(2026);
  });
  it("the footer uses it", () => {
    const src = readFileSync("src/components/site/SiteFooterView.tsx", "utf8");
    expect(src).toContain("const year = footerYear();");
    expect(src).not.toContain("new Date().getFullYear()");
  });
});
