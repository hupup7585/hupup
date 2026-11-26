import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/* Hark's Phases 1-3 review, item 10 (Nov 26, 2026): undo and restore on All settings. */
describe("undo and restore", () => {
  const page = readFileSync("src/app/admin/(app)/config/page.tsx", "utf8");
  it("a setting changed on its own page shows the earlier value and a link to put it back there (its checks run)", () => {
    expect(page).toContain("data-config-page-undo");
    expect(page).toContain("Open its page</Link> and set it back to that.");
  });
  it("an older version of a setting edited here can be put back as a draft (then published as usual)", () => {
    expect(page).toContain("data-config-restore={v.id}");
    expect(page).toMatch(/<form action=\{saveDraftAction\} className="inline">/);
  });
  it("each version shows the old value next to the new one (compare)", () => {
    expect(page).toContain("{show(unwrap(v.previous))} → {show(unwrap(v.value))}");
  });
});
