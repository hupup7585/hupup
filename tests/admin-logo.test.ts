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
    ["src/app/admin/login/LoginForm.tsx", 128, "mx-auto h-32 w-auto"],
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

describe("staff pages have their own description", () => {
  it("never the customer home page's description, and never indexed", async () => {
    const { metadata } = await import("@/app/admin/layout");
    expect(metadata.description).toBe("Staff sign-in and tools for Hup Up Attractions.");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});

describe("staff sign-in design (Abraham)", () => {
  const form = readFileSync("src/app/admin/login/LoginForm.tsx", "utf8");
  it("bigger card and logo; logo on light blue #8CCBFF, never on navy; yellow accent; navy and white", () => {
    expect(form).toMatch(/data-signin-card className="[^"]*sm:max-w-\[560px\][^"]*bg-white/); // about 560px wide on desktop (Abraham)
    expect(form).toMatch(/data-signin-logo-panel className="[^"]*bg-sky/);
    const panel = form.slice(form.indexOf("data-signin-logo-panel"), form.indexOf("data-signin-accent"));
    expect(panel).toContain("hupup-logo-h128@1x.png"); // the logo sits inside the light blue panel
    expect(panel).not.toMatch(/bg-navy/);
    expect(form).toMatch(/data-signin-accent className="[^"]*bg-sun/);
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css).toContain("--color-sky: #8ccbff");
    expect(css).toContain("--color-sun: #ffd84d");
    expect(css).toContain("--color-navy: #123d73");
  });
  it("wording (Abraham's sign-in choices)", () => {
    // Abraham (Nov 9): front page offers "Sign in with password" or "Send me a code", then "By email" or "By text (SMS)"
    for (const w of ["Staff sign-in", "Your mobile number", "Sign in with password", "Send me a code", "By email", "By text (SMS)", "6-digit code", "Keep me signed in on this device for 30 days"]) expect(form).toContain(w);
  });
});
