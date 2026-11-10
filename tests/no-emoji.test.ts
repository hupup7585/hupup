import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/* Abraham's standing rule: no emoji anywhere on the website or in Admin; thin line icons only. */
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2705}\u{274C}\u{2716}\u{21A9}\u{2B07}\u{23F3}\u{231B}\u{FE0F}]/u;
describe("no emoji on screens", () => {
  it("no page or component shows an emoji (code comments aside)", () => {
    const files: string[] = [];
    const walk = (d: string) => readdirSync(d).forEach((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : /\.tsx$/.test(f) && files.push(join(d, f))));
    walk("src/app");
    walk("src/components");
    const bad = files.flatMap((f) =>
      readFileSync(f, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .map((l, i) => [f, i + 1, l] as const)
        .filter(([, , l]) => !l.trim().startsWith("//") && EMOJI.test(l)),
    );
    expect(bad.map(([f, i, l]) => `${f}:${i}: ${l.trim()}`)).toEqual([]);
  });
});
