import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { SETTING_DEFAULTS } from "@/lib/settings";
import { websiteHoursLines, websiteOpeningHoursSpec } from "@/lib/business-hours";

const read = (f: string) => readFileSync(f, "utf8");
const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe("public website uses the real site address, never a vercel.app one (item 7, Nov 25, 2026)", () => {
  it("sitemap and robots point at hupupattractions.com on the live site even when PUBLIC_BASE_URL is a vercel.app address", async () => {
    process.env = { ...saved, VERCEL_ENV: "production", PUBLIC_BASE_URL: "https://hupup.vercel.app" };
    delete process.env.PUBLIC_SITE_URL;
    const sitemap = (await import("@/app/sitemap")).default();
    expect(sitemap.length).toBeGreaterThan(0);
    for (const e of sitemap) expect(e.url.startsWith("https://hupupattractions.com")).toBe(true);
    const robots = (await import("@/app/robots")).default();
    expect(robots.sitemap).toBe("https://hupupattractions.com/sitemap.xml");
  });

  it("previews still have no sitemap and block crawling", async () => {
    process.env = { ...saved, VERCEL_ENV: "preview" };
    expect((await import("@/app/sitemap")).default()).toEqual([]);
    expect((await import("@/app/robots")).default().rules).toEqual([{ userAgent: "*", disallow: "/" }]);
  });

  it("no public page reads PUBLIC_BASE_URL or baseUrl() for an address people or search engines see", () => {
    for (const f of [
      "src/app/layout.tsx",
      "src/app/page.tsx",
      "src/app/robots.ts",
      "src/app/sitemap.ts",
      "src/app/sms-terms/SmsTermsV3.tsx",
      "src/app/text-alerts/actions.ts",
      "src/app/pay/[orderId]/actions.ts",
    ]) {
      expect(read(f), f).not.toMatch(/PUBLIC_BASE_URL|config\.baseUrl\(\)/);
    }
    // the pay page consent records keep the order number the customer's link shows (1000 + id)
    expect(read("src/app/pay/[orderId]/actions.ts")).toContain("/pay/${orderNumber(orderId)}");
  });
});

describe("LocalBusiness schema hours match the Our Hours list (Hours page schedule)", () => {
  it("defaults: Monday to Thursday and Sunday, Friday and Shabbes left out", () => {
    const spec = websiteOpeningHoursSpec({ ...SETTING_DEFAULTS });
    expect(spec).toEqual([
      { "@type": "OpeningHoursSpecification", dayOfWeek: "Sunday", opens: "11:30", closes: "19:00" },
      { "@type": "OpeningHoursSpecification", dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday"], opens: "10:30", closes: "19:00" },
    ]);
  });

  it("follows a change saved on the Hours page (the old Mon-Thu setting no longer decides)", () => {
    const s = { ...SETTING_DEFAULTS, hoursSchedules: "" as string };
    const office = {
      days: {
        "0": { closed: false, windows: [{ from: "12:00", to: "18:00" }] },
        "1": { closed: false, windows: [{ from: "09:00", to: "17:00" }] },
        "2": { closed: false, windows: [{ from: "09:00", to: "17:00" }] },
        "3": { closed: true, windows: [] },
        "4": { closed: false, windows: [{ from: "09:00", to: "17:00" }] },
        "5": { closed: false, windows: [{ from: "10:00", to: "chatzos" }] },
        "6": { closed: true, windows: [] },
      },
      chanukah: { same: true, windows: [] },
      cholHamoed: { same: true, windows: [] },
      overrides: [],
    };
    s.hoursSchedules = JSON.stringify({ lines: { office: { schedule: office, on: true } }, groups: [] });
    expect(websiteOpeningHoursSpec(s)).toEqual([
      { "@type": "OpeningHoursSpecification", dayOfWeek: "Sunday", opens: "12:00", closes: "18:00" },
      { "@type": "OpeningHoursSpecification", dayOfWeek: ["Monday", "Tuesday", "Thursday"], opens: "09:00", closes: "17:00" },
    ]);
    // the visible list reads the same schedule
    expect(websiteHoursLines(s).join("\n")).toMatch(/9:00 AM/);
  });

  it("the home page builds its schema hours from it", () => {
    const page = read("src/app/page.tsx");
    expect(page).toContain("openingHoursSpecification: websiteOpeningHoursSpec(settings)");
    expect(page).not.toMatch(/settings\.hoursMonThu|settings\.hoursSunday/);
  });
});
