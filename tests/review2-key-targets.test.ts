import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { brokenKeys, keyTargetProblem, type KeyTargets } from "@/lib/screen-keys";

/* Hark's Phases 1-3 review, item 4 (Nov 26, 2026): every key set on Phone screens goes somewhere real. */
const t: KeyTargets = {
  products: new Map([[1, { name: "Castle", active: true }], [2, { name: "Old slide", active: false }]]),
  lines: new Set(["main_menu", "custom_line_a"]),
  hotline: "+18454157585",
};
describe("bad key targets are refused, in plain words", () => {
  it.each([
    [{ type: "screen", target: "nowhere" }, "is not a menu or step"],
    [{ type: "ring", ext: "7" }, "is not an extension that rings"],
    [{ type: "voicemail", box: "3" }, "is not a voicemail box"],
    [{ type: "item", productId: 99 }, "no longer exists"],
    [{ type: "item", productId: 2 }, "switched off (archived)"],
    [{ type: "forward", phone: "555-0123" }, "10-digit"],
    [{ type: "forward", phone: "845-415-7585" }, "hotline itself"],
    [{ type: "play", lines: ["gone_line"] }, "do not exist any more"],
    [{ type: "play", lines: [] }, "at least one recording"],
  ])("%o", (action, words) => expect(keyTargetProblem(action as never, t)).toContain(words));
  it("good targets pass", () => {
    for (const a of [{ type: "screen", target: "book" }, { type: "ring", ext: "4" }, { type: "voicemail", box: "9" }, { type: "item", productId: 1 }, { type: "forward", phone: "(845) 777-7585" }, { type: "play", lines: ["main_menu", "custom_line_a"] }, { type: "back" }])
      expect(keyTargetProblem(a as never, t)).toBeNull();
  });
  it("an item archived after its key was set shows as a broken key", () => {
    const e = { layouts: {}, extra: {}, keys: { cats: [{ key: "7", on: true, action: { type: "item", productId: 2 } }] } } as never;
    expect(brokenKeys(e, t)).toEqual([{ screen: "cats", key: "7", problem: expect.stringContaining("Old slide") }]);
  });
  it("checked when saving a key, again at publish, and listed on the screen page", () => {
    expect(readFileSync("src/app/admin/(app)/phone/screens/actions.ts", "utf8")).toContain("keyTargetProblem(action, await loadKeyTargets())");
    expect(readFileSync("src/lib/screen-drafts.ts", "utf8")).toContain("brokenKeys(draft as never, targets)");
    expect(readFileSync("src/app/admin/(app)/phone/screens/[id]/page.tsx", "utf8")).toContain("data-broken-keys");
  });
});
