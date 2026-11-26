import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { activeKey, isProtectedScreen, protectedKeyProblems, protectedKeys, setKey, type Editor } from "@/lib/ivr/menu-editor";

/* Hark's Phases 1-3 review, item 3 (Nov 26, 2026): keys on the Terms, consent, payment, read-back and voicemail
 * password steps cannot be changed in Admin (a 1 on Terms sent callers to the main menu, so no booking finished). */
const empty = (): Editor => ({ layouts: {}, extra: {}, keys: {} });
const menuKey = { key: "1", on: true, action: { type: "goto", screen: "menu" } } as never;
const PROTECTED = ["terms", "sms-consent", "pay-consent", "pay-choice", "readback", "promo-consent", "phonepay-go", "phonepay-retry", "vma-pin", "vma-box", "vma-options"];

describe("protected steps", () => {
  it.each(PROTECTED)("%s: every key is protected and setKey refuses with a plain reason", (screen) => {
    expect(isProtectedScreen(screen)).toBe(true);
    expect(protectedKeys(screen)).toBe("0123456789");
    const r = setKey(empty(), screen, { ...(menuKey as object), key: "1" } as never);
    expect("error" in r && r.error).toMatch(/protected/);
  });
  it("an ordinary menu still takes Admin keys", () => {
    expect(isProtectedScreen("menu")).toBe(false);
    const r = setKey(empty(), "menu", { ...(menuKey as object), key: "9" } as never);
    expect("error" in r).toBe(false);
  });
  it("an old stored key on a protected step is ignored on a live call", () => {
    const e: Editor = { ...empty(), keys: { terms: [menuKey] } };
    expect(activeKey(e, "terms", "1")).toBeNull();
  });
  it("publishing refuses a draft that holds such a key", () => {
    expect(protectedKeyProblems({ ...empty(), keys: { terms: [menuKey], menu: [{ ...(menuKey as object), key: "9" } as never] } })).toEqual(["terms: key 1"]);
    const drafts = readFileSync("src/lib/screen-drafts.ts", "utf8");
    expect(drafts).toContain("protectedKeyProblems(draft as never)");
  });
  it("the screen page shows those keys as Protected and offers no key form there", () => {
    const page = readFileSync("src/app/admin/(app)/phone/screens/[id]/page.tsx", "utf8");
    expect(page).toContain("data-key-protected");
    expect(page).toContain("data-keys-protected");
  });
});
