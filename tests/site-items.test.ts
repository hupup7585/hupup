import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { sitePrice, sizeLabel, websiteItemsShown, WEBSITE_ITEMS_LIVE_APPROVED } from "@/lib/site-content";

/* Website items (Abraham, Nov 18, 2026): name, description, "Size: 15 x 15 ft" and price; preview first. */
describe("website items", () => {
  it("size label as Abraham wrote it", () => {
    expect(sizeLabel("15 by 15 feet")).toBe("15 x 15 ft");
    expect(sizeLabel("15x15 ft")).toBe("15 x 15 ft");
    expect(sizeLabel("20 x 30 x 12 feet")).toBe("20 x 30 x 12 ft");
    expect(sizeLabel("")).toBe("");
  });
  it("prices", () => {
    expect(sitePrice(15000)).toBe("$150");
    expect(sitePrice(6250)).toBe("$62.50");
    expect(sitePrice(120000)).toBe("$1,200");
  });
  it("preview only until approved", () => {
    expect(WEBSITE_ITEMS_LIVE_APPROVED).toBe(false);
    expect(websiteItemsShown({ VERCEL_ENV: "production" })).toBe(false);
    expect(websiteItemsShown({ VERCEL_ENV: "preview" })).toBe(true);
    const page = readFileSync("src/app/page.tsx", "utf8");
    expect(page).toContain("Size: {it.size}");
    expect(page.match(/<h1/g)).toHaveLength(1);
  });
});
