import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("public phone number", () => {
  it("website number is (845) 777-7585 / +18457777585 by default", async () => {
    const saved = { e: process.env.NEXT_PUBLIC_HOTLINE_E164, d: process.env.NEXT_PUBLIC_HOTLINE_DISPLAY };
    delete process.env.NEXT_PUBLIC_HOTLINE_E164;
    delete process.env.NEXT_PUBLIC_HOTLINE_DISPLAY;
    const { config, PUBLIC_PHONE_DISPLAY, PUBLIC_PHONE_E164 } = await import("@/lib/config");
    expect(PUBLIC_PHONE_DISPLAY).toBe("(845) 777-7585");
    expect(PUBLIC_PHONE_E164).toBe("+18457777585");
    expect(config.hotlineE164).toBe("+18457777585");
    expect(config.hotlineDisplay).toBe("(845) 777-7585");
    process.env.NEXT_PUBLIC_HOTLINE_E164 = saved.e;
    process.env.NEXT_PUBLIC_HOTLINE_DISPLAY = saved.d;
  });
  it("public pages contain no old or placeholder numbers", () => {
    for (const f of ["src/app/page.tsx", "src/app/paid/page.tsx"]) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/415-?7585|4157585|000-0000/);
    }
  });
  it("IVR and SMS code never use the public display number", () => {
    for (const f of ["src/lib/ivr/flow.ts", "src/lib/sms.ts", "src/lib/sms-inbound.ts", "src/lib/notify.ts"]) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/hotlineE164|hotlineDisplay|NEXT_PUBLIC_HOTLINE|7777585/);
    }
  });
});
