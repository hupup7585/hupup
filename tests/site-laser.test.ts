import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dollars, LASER_LIST_COPY, LASER_LIST_LIVE_APPROVED, laserListShown } from "@/lib/site-laser";

/* Website laser tag choices with prices (Abraham, Nov 17, 2026): draft on preview until he approves. */
describe("laser tag price list on the website", () => {
  it("shows on preview only until approved", () => {
    expect(LASER_LIST_LIVE_APPROVED).toBe(false);
    expect(laserListShown({ VERCEL_ENV: "production" })).toBe(false);
    expect(laserListShown({ VERCEL_ENV: "preview" })).toBe(true);
  });
  it("draft wording and prices", () => {
    expect(LASER_LIST_COPY.heading).toBe("Choices and prices");
    expect(LASER_LIST_COPY.addOnsLine(dollars(7500), dollars(5000))).toBe(
      "Need more players? Add more laser guns to any maze or laser gun choice: a 6-pack for $75 or a 4-pack for $50.",
    );
    expect(dollars(3750)).toBe("$37.50");
  });
  it("the landing page keeps exactly one H1 and reads the list from the catalog", () => {
    const page = readFileSync("src/app/page.tsx", "utf8");
    expect(page.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(page).toContain("data-laser-prices");
    expect(page).toContain("laserListShown() ? await laserPriceList() : null");
  });
});
