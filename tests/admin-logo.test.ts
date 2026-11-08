import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/* Abraham: the staff logo must be crisp. Exact-size 1x/2x/3x files made from the full-size original, never enlarged. */
const pngSize = (f: string) => {
  const b = readFileSync(f);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
};

describe("staff logo is sharp on every screen", () => {
  const original = pngSize("public/brand/hupup-logo.png");
  for (const [file, cssH, cls] of [
    ["src/app/admin/login/LoginForm.tsx", 80, "h-20 w-auto"],
    ["src/components/Sidebar.tsx", 96, "mx-auto h-24 w-auto"],
  ] as const) {
    it(`${file}: ${cssH}px tall, with 1x, 2x and 3x files at the exact size`, () => {
      const src = readFileSync(file, "utf8");
      expect(src).not.toContain("hupup-logo-320.png");
      expect(src).toContain(`className="${cls}"`); // same size and place as before
      for (const s of [1, 2, 3]) {
        const path = `/brand/hupup-logo-h${cssH}@${s}x.png`;
        expect(src).toContain(`${path} ${s}x`);
        const { w, h } = pngSize(`public${path}`);
        expect(h).toBe(cssH * s);
        expect(Math.abs(w / h - original.w / original.h)).toBeLessThan(0.01); // same shape
        expect(h).toBeLessThanOrEqual(original.h); // made smaller from the original, never enlarged
      }
    });
  }
});
