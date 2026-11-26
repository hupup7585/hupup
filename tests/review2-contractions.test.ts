import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { hasContraction } from "@/lib/no-contractions";

/* Hark's Phases 1-3 review, item 12 (Nov 26, 2026): curly apostrophes are contractions too. */
describe("no contractions in spoken wording", () => {
  it.each(["you’re", "don’t", "it’s", "we’ll", "you're", "don't", "it's", "we've", "I’m", "he’d"])("%s is refused", (w) => expect(hasContraction(`Thank you, ${w} all set.`)).toBe(true));
  it.each(["You are all set.", "Let's begin.", "Let’s begin.", "Hup Up Attractions"])("%s passes (no contraction, or the allowed let's)", (t) => expect(hasContraction(t)).toBe(false));
  it("checked wherever spoken prompt text is saved: new slots (and lines added on Phone screens) and Hotline prompts", () => {
    expect(readFileSync("src/lib/custom-slots.ts", "utf8")).toContain("if (hasContraction(text)) return { ok: false, message: NO_CONTRACTIONS_MESSAGE };");
    expect(readFileSync("src/app/admin/(app)/phone/prompts/actions.ts", "utf8")).toContain("if (def && !def.message && hasContraction(text)) return { ok: false, message: NO_CONTRACTIONS_MESSAGE };");
  });
});
