import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { FINAL_CTA_TEXT, FINAL_CTA_TITLE, INTRO, SLOGAN, STEPS, WHY } from "@/lib/site-copy";
import { theme } from "@/lib/theme";
import { categoryIcon } from "@/components/site/parts";
import { Castle, Crosshair, PartyPopper, Sailboat } from "lucide-react";

describe("website copy and brand", () => {
  it("uses Abram's exact slogan and copy", () => {
    expect(SLOGAN).toBe("BRINGING SOMETHING SPECIAL TO EVERY OCCASION");
    expect(INTRO).toBe(
      "Make your next event unforgettable with exciting attractions and rentals from Hup Up Attractions. We bring something special to parties, schools, celebrations, and special occasions.",
    );
    expect(FINAL_CTA_TITLE).toBe("READY TO MAKE YOUR EVENT SPECIAL?");
    expect(FINAL_CTA_TEXT).toBe("Contact Hup Up Attractions today to explore our rental options and reserve your attraction.");
    expect(WHY).toHaveLength(6);
    expect(STEPS.map((s) => s[1])).toEqual(["EXPLORE", "CALL", "CONFIRM"]);
  });
  it("main titles have no hyphens, slashes or dots", () => {
    for (const t of [SLOGAN, FINAL_CTA_TITLE, "Our Rentals", "Why Choose Hup Up Attractions", "How It Works", "Service Area", "Contact Us"]) {
      expect(t).not.toMatch(/[-/.]/);
    }
  });
  it("brand palette is Abram's", () => {
    expect(theme).toMatchObject({ yellow: "#FFD84D", sky: "#8CCBFF", white: "#FFFFFF", deep: "#123D73" });
  });
  it("uses one icon set (Lucide) and no photos or emoji on the homepage", () => {
    const page = readFileSync("src/app/page.tsx", "utf8");
    expect(page).not.toMatch(/<img|PhotoSlot|Gallery/);
    expect(page).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(page).not.toMatch(/gradient|backdrop-blur|blur-/);
    expect(categoryIcon("Bounce Houses")).toBe(Castle);
    expect(categoryIcon("Laser Tag and Inflatable Mazes")).toBe(Crosshair);
    expect(categoryIcon("Paddle Boats")).toBe(Sailboat);
    expect(categoryIcon("Photo Booths")).toBe(PartyPopper);
  });
  it("has no online cart or checkout on the public site", () => {
    const page = readFileSync("src/app/page.tsx", "utf8");
    expect(page).not.toMatch(/add to cart|checkout/i);
  });
});
