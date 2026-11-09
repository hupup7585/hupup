import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";

/* Abraham: the website header logo is bigger and sharp, straight on the white header with a very soft shadow (Nov 9, 2026). */
describe("website header logo", () => {
  const parts = readFileSync("src/components/site/parts.tsx", "utf8");
  it("uses the sharp 96px files at 1x, 2x and 3x as a plain image (no Next image compression)", () => {
    expect(parts).toContain('"/brand/hupup-logo-h96@1x.png 1x, /brand/hupup-logo-h96@2x.png 2x, /brand/hupup-logo-h96@3x.png 3x"');
    for (const f of ["h96@1x", "h96@2x", "h96@3x"]) expect(existsSync(`public/brand/hupup-logo-${f}.png`)).toBe(true);
    expect(parts).not.toMatch(/from "next\/image"/);
    expect(parts).toContain("<img");
  });
  it("72px tall on phones, 96px on desktop, on white (no light-blue tile) with a tiny soft shadow", () => {
    expect(parts).toContain('className="block h-[72px] w-auto sm:h-24 [filter:drop-shadow(0_1px_1px_rgba(18,61,115,0.22))]"');
    expect(parts).toContain('<span data-logo-white className="inline-block">');
    expect(parts).not.toContain("8CCBFF");
  });
});
