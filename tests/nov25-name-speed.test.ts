import { describe, expect, it } from "vitest";
import { nameVoiceLink, verifyNameVoiceLink } from "@/lib/signed-link";
import { readFileSync } from "node:fs";

/* Abraham, Nov 25, 2026, 12:36: household names said live 10 percent faster (Admin "Speed for spoken names", 1.1). */
describe("speed for spoken names", () => {
  it("default 1.1, an Admin setting", async () => {
    const { SETTING_DEFAULTS } = await import("@/lib/settings");
    expect(SETTING_DEFAULTS.nameSpeakingRate).toBe("1.1");
    expect(readFileSync("src/app/admin/(app)/settings/page.tsx", "utf8")).toContain("<NameSpeedForm");
  });
  it("the Google link carries the speed, signed; another speed or name is refused", () => {
    const link = new URL(nameVoiceLink("Klein, Sara.", 1.1));
    expect(link.pathname).toBe("/api/voice-audio/name");
    expect(link.searchParams.get("r")).toBe("1.10");
    expect(verifyNameVoiceLink(link.searchParams.get("t"), "1.10", link.searchParams.get("sig"))).toEqual({ text: "Klein, Sara.", rate: 1.1 });
    expect(verifyNameVoiceLink(link.searchParams.get("t"), "1.50", link.searchParams.get("sig"))).toBeNull();
  });
  it("only names use it: the address lookup says names through sayName; other live text does not", () => {
    const flow = readFileSync("src/lib/ivr/flow.ts", "utf8");
    expect(flow.match(/await sayName\(/g)?.length).toBe(2); // one family, and each family on a shared number
    expect(flow).not.toMatch(/say\(g, `\$\{name\(/);
  });
});
