import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { UNREACHED_SCREENS } from "@/lib/ivr/unreached.generated";
import { SCREENS } from "@/lib/ivr/screens";

/* Hark's Phases 1-3 review, item 14 (Nov 26, 2026): screens no call can reach are marked "Not reached (kept so old
 * routes do not break)" on Phone screens and in the Recording library. */
describe("screens no call reaches", () => {
  it("the list is current (worked out from every step a call can go to)", () => {
    execSync("node scripts/screen-reach.mjs --check", { stdio: "pipe" });
  });
  it("found the old ones (old product step, old pay choice, old promo steps), and nothing the caller uses now", () => {
    expect([...UNREACHED_SCREENS]).toEqual(expect.arrayContaining(["product", "pay-choice", "promo-which"]));
    for (const live of ["menu", "book", "cart", "pay-approved", "promo-consent", "tx-which", "terms"]) if (SCREENS[live]) expect(UNREACHED_SCREENS).not.toContain(live);
  });
  it("every one of them is marked on Phone screens, its own page and the Recording library", () => {
    for (const f of ["src/app/admin/(app)/phone/screens/page.tsx", "src/app/admin/(app)/phone/screens/[id]/page.tsx", "src/app/admin/(app)/phone/library/page.tsx"]) {
      const s = readFileSync(f, "utf8");
      expect(s).toContain("UNREACHED_SCREENS.includes(");
      expect(s).toMatch(/[Nn]ot reached[^<]*kept so old routes do not break/);
    }
  });
});
