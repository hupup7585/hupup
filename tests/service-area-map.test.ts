import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { SERVICE_AREA_MAP_URL } from "@/lib/site-copy";

/* Abraham X: the service area opens Google Maps in a new tab; the wording doesn't change. */
describe("service area map link", () => {
  it("uses Abraham's exact Google Maps link", () => {
    expect(SERVICE_AREA_MAP_URL).toBe("https://www.google.com/maps/search/?api=1&query=Kiryas%20Joel%2C%20NY");
  });
  it("Contact block and the Service Area card link to it in a new tab with a clear label, same wording", () => {
    const page = readFileSync("src/app/page.tsx", "utf8");
    expect(page).toContain("href={SERVICE_AREA_MAP_URL}");
    expect(page).toContain("Plus nearby {c.serviceArea.region} towns");
    const card = readFileSync("src/components/site/ServiceAreaC.tsx", "utf8");
    for (const f of [page, card]) {
      expect(f).toContain('target="_blank"');
      expect(f).toContain('rel="noopener noreferrer"');
      expect(f).toContain("open in Google Maps (opens in a new tab)");
    }
  });
});
