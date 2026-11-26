import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { MENU_COMBOS, PROMPTS, RETIRED_PROMPTS } from "@/lib/ivr/prompts";
import { allSlots } from "@/lib/recording-slots";
import { libraryReconciliation, recordingLibrary } from "@/lib/recording-library";

/* Admin handoff Phase 3, section 7 (Nov 26, 2026): one library of every phone line; the code and Admin slot counts
 * reconcile; every combined recording slot is listed (whole_stay_on_line, whole_skip_pound, whole_cart_key); retired
 * lines stay as legacy (never deleted); lines nothing plays are shown, not hidden; the where-used files are current. */
describe("the recording library", () => {
  it("every line in the code is listed once, with a kind and its recording slots", async () => {
    const lib = recordingLibrary();
    expect(lib.map((e) => e.key).sort()).toEqual(Object.keys(PROMPTS).sort());
    // a line made only of spoken values (for example the address read-back) has no fixed words to record
    const { pieces } = await import("@/lib/recording-slots");
    for (const e of lib) if (e.kind !== "voice" && e.kind !== "shared" && pieces(e.text).length) expect(e.slotKeys.length, e.key).toBeGreaterThan(0);
  });
  it("the counts reconcile: every Admin line slot belongs to a library line", () => {
    const r = libraryReconciliation();
    expect(r.notInLibrary).toEqual([]);
    expect(r.lineSlots + r.otherSlots).toBe(allSlots().length);
    expect(Object.values(r.byKind).reduce((a, b) => a + b, 0)).toBe(r.lines);
  });
  it("every combined recording slot in the code is in the library and in Admin", () => {
    const slots = new Set(allSlots().map((s) => s.key));
    const lib = new Map(recordingLibrary().map((e) => [e.key, e]));
    for (const id of Object.keys(MENU_COMBOS)) {
      expect(slots.has(`whole_${id}`), id).toBe(true);
      expect(lib.get(`whole_${id}`)?.kind, id).toBe(RETIRED_PROMPTS.has(`whole_${id}`) ? "legacy" : "combined"); // whole_hours: retired on purpose (key 7)
    }
    for (const k of ["whole_stay_on_line", "whole_skip_pound", "whole_cart_key"]) expect(slots.has(k), k).toBe(true);
  });
  it("retired lines stay listed as legacy with their slots (never deleted)", () => {
    const lib = recordingLibrary();
    for (const e of lib.filter((x) => RETIRED_PROMPTS.has(x.key))) expect(e.kind).toBe("legacy");
    expect(lib.filter((e) => e.kind === "legacy").length).toBeGreaterThan(50);
  });
  it("lines nothing plays now are shown (today: the removed after-payment lines among them)", () => {
    const { unused } = libraryReconciliation();
    expect(unused).toContain("goodbye_order");
    expect(unused).toContain("phonepay_approved_bye");
    expect(unused).not.toContain("disconnect_goodbye");
  });
  it("the generated where-used files are current", () => {
    execSync("node scripts/recording-usage.mjs --check", { stdio: "pipe" });
    execSync("node scripts/config-usage.mjs --check", { stdio: "pipe" });
  });
  it("the Admin page: Owner only, the counts, each kind explained, search, screen links, edit links", () => {
    const page = readFileSync("src/app/admin/(app)/phone/library/page.tsx", "utf8");
    for (const s of ["await requireOwner()", "The counts add up", "KIND_HELP", "Not played now", "/admin/phone/screens/", "Edit in Hotline prompts"]) expect(page).toContain(s);
  });
});
