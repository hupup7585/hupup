import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/* Hark's Nov 24 Admin PHONE SYSTEM list, the rest (Nov 27, 2026): Admin text and feedback only, nothing callers hear. */
import { digitWaits } from "@/lib/phonepay-digits";
import { RETIRED_PROMPTS } from "@/lib/ivr/prompts";
import { STEP_LABELS } from "@/lib/call-journey";

const read = (f: string) => readFileSync(f, "utf8");

describe("phone audit, Nov 24 list", () => {
  it("6: the Try column uses the card tries setting, never a fixed 6", () => {
    const s = read("src/app/admin/(app)/phone/phonepay/page.tsx");
    expect(s).not.toContain("of 6`");
    expect(s).toContain("phonePayLimits(s as never).triesPerCall");
  });
  it("22: the digits help describes the saved waits (each w is half a second)", () => {
    expect(digitWaits("wwwwww{pin}#wwwwwwwwwwww{amount}#wwwwww1")).toEqual([3, 6, 3]);
    expect(digitWaits("wwwwwwwwww{pin}#")).toEqual([5]);
  });
  it("8: Card blocks counts calls with card tries, not declines", () => {
    const s = read("src/app/admin/(app)/phone/card-blocks/page.tsx");
    expect(s).toContain("calls with card tries in 24 hours");
    expect(s).not.toMatch(/declines in 24 hours/);
  });
  it("13: the two old keypad help lines no step plays are retired", () => {
    expect(RETIRED_PROMPTS.has("catalog_keypad_help")).toBe(true);
    expect(RETIRED_PROMPTS.has("address_keypad_help")).toBe(true);
  });
  it("24: journey steps that showed their raw name have plain names", () => {
    for (const k of ["date-ask", "balloon-key2", "box18-choice", "idle"]) expect(STEP_LABELS[k], k).toBeTruthy();
  });
  it("28: System status says the jobs run every 3 hours, not once a day", () => {
    const s = read("src/app/admin/(app)/status/page.tsx");
    expect(s).toContain("Timed jobs");
    expect(s).not.toContain("Each job runs once a day");
  });
  it("29: each listed page has its own title", () => {
    for (const [f, t] of [["phone/settings", "Phone settings"], ["phone/music", "Music"], ["compliance", "Compliance"], ["voicemail", "Voicemail"], ["calls", "Call log"]])
      expect(read(`src/app/admin/(app)/${f}/page.tsx`), f).toContain(`title: "${t} · Hup Up Attractions"`);
  });
  it("19, 23, 30: saves say Saved, and a failed save says Not saved", () => {
    expect(read("src/app/admin/(app)/phone/menu-order/actions.ts")).toContain("msgQuery(");
    expect(read("src/app/admin/(app)/phone/music/actions.ts")).toContain('msgQuery("Saved.")');
    expect(read("src/app/admin/(app)/phone/music/MusicUpload.tsx")).toContain('aria-label="Choose song files"');
    for (const f of ["email-actions.ts", "pricing-actions.ts"]) expect(read(`src/app/admin/(app)/settings/${f}`), f).toContain("Not saved. Please try again.");
  });
  it("20, 27: headings name the real extensions; times say Eastern; Holidays says what shows on the website", () => {
    expect(read("src/app/admin/(app)/phone/settings/page.tsx")).toContain("Extensions 2, 3, 4, 5 and 0, and Bookings menu key 9: Schools");
    expect(read("src/app/admin/(app)/settings/RoutingForm.tsx")).toContain("Eastern time");
    expect(read("src/app/admin/(app)/holidays/page.tsx")).toContain("Only the website note under the hours");
  });
});
