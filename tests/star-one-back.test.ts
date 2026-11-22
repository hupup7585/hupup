import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/* Star = one menu back, everywhere (Abraham, Nov 18, 2026). Only the main menu's own sub-menus go to the main menu. */
describe("star key", () => {
  const f = readFileSync("src/lib/ivr/flow.ts", "utf8");
  const step = (name: string) => f.slice(f.indexOf(`"${name}"(ctx`), f.indexOf("\n  },", f.indexOf(`"${name}"(ctx`)));
  it("the closest options go back to same date or nearest date; near-choice back to booked", () => {
    expect(step("nearest-choice")).toContain('if (d === "*") return starToCategory(vr, Number(p));');
    expect(step("taken-choice")).toContain('if (d === "*") return starToCategory(vr, p);');
    expect(step("after-add")).toContain('if (d === "*") return back(vr, "book");');
    expect(step("catalog-done")).toContain('return back(vr, "menu");'); // box 109: star = the main menu (Nov 22, 2026)
  });
  it("only the main menu's own sub-menus send star to the main menu", () => {
    const lines = f.split("\n").filter((l) => /"\*"\) return back\(vr, "menu"\)/.test(l));
    expect(lines).toHaveLength(5); // catalog (key 8), keys 2 and 3, bookings (key 1), welcome back, catalog emailed (box 109)
  });
});
