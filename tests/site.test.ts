import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { FINAL_CTA_TEXT, FINAL_CTA_TITLE, INTRO, SLOGAN, STEPS, WHY } from "@/lib/site-copy";
import { theme } from "@/lib/theme";
import { categoryIcon } from "@/lib/category-icons";
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

describe("public phone number", () => {
  it("website shows (845) 777-7585 / +18457777585, while the Twilio hotline stays separate", async () => {
    const { PUBLIC_PHONE_DISPLAY, PUBLIC_PHONE_E164 } = await import("@/lib/config");
    expect(PUBLIC_PHONE_DISPLAY).toBe("(845) 777-7585");
    expect(PUBLIC_PHONE_E164).toBe("+18457777585");
    for (const f of ["src/app/page.tsx", "src/app/opengraph-image.tsx", "src/app/privacy/page.tsx", "src/app/terms/page.tsx", "src/components/site/SiteHeader.tsx", "src/components/site/SiteFooter.tsx", "src/lib/site-content.ts"]) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/415-?7585|4157585/);
    }
  });
  it("defaults to the public number when the env var is not set", async () => {
    const saved = { e: process.env.NEXT_PUBLIC_HOTLINE_E164, d: process.env.NEXT_PUBLIC_HOTLINE_DISPLAY };
    delete process.env.NEXT_PUBLIC_HOTLINE_E164;
    delete process.env.NEXT_PUBLIC_HOTLINE_DISPLAY;
    const { config } = await import("@/lib/config");
    expect(config.hotlineE164).toBe("+18457777585");
    expect(config.hotlineDisplay).toBe("(845) 777-7585");
    process.env.NEXT_PUBLIC_HOTLINE_E164 = saved.e;
    process.env.NEXT_PUBLIC_HOTLINE_DISPLAY = saved.d;
  });
  it("IVR and SMS code never use the public display number", () => {
    for (const f of ["src/lib/ivr/flow.ts", "src/lib/sms.ts", "src/lib/sms-inbound.ts", "src/lib/notify.ts"]) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/hotlineE164|hotlineDisplay|NEXT_PUBLIC_HOTLINE|7777585/);
    }
  });
});

describe("service area", () => {
  it("uses Abram's exact towns with Kiryas Joel / Town of Palm Tree as the main area", async () => {
    const { SERVICE_AREA, serviceAreaPlaces } = await import("@/lib/site-copy");
    expect(SERVICE_AREA.mainLabel).toBe("Our main service area:");
    expect(SERVICE_AREA.main).toBe("Kiryas Joel / Town of Palm Tree");
    expect(SERVICE_AREA.alsoTitle).toBe("We also deliver to these nearby towns:");
    expect([...SERVICE_AREA.also]).toEqual(["Monroe", "Blooming Grove", "Woodbury / Highland Mills", "Chester", "Harriman", "Middletown", "Washingtonville"]);
    expect(SERVICE_AREA.region).toBe("Orange County, NY");
    expect(serviceAreaPlaces()).toEqual([
      "Kiryas Joel", "Town of Palm Tree", "Monroe", "Blooming Grove", "Woodbury", "Highland Mills", "Chester", "Harriman", "Middletown", "Washingtonville",
    ]);
  });
  it("homepage shows the section and nav link, main area before the secondary list, and no placeholder text", () => {
    const page = readFileSync("src/app/page.tsx", "utf8");
    const header = readFileSync("src/components/site/SiteHeader.tsx", "utf8");
    expect(page).toContain('id="service-area"');
    expect(header).toContain('["Service Area", "/#service-area"]');
    expect(page.indexOf("serviceArea.mainLabel")).toBeLessThan(page.indexOf("serviceArea.alsoTitle"));
    expect(page).toContain("areaServed");
    expect(page).toMatch(/Kiryas Joel \/ Town of Palm Tree/);
    expect(page).not.toMatch(/Call to check your area/);
  });
});

describe("rentals list", () => {
  it("has no 01/02/03 number labels", () => {
    expect(readFileSync("src/app/page.tsx", "utf8")).not.toMatch(/padStart\(2/);
  });
});

describe("contact list", () => {
  it("phone row matches the other rows and the service area shows the main area", () => {
    const page = readFileSync("src/app/page.tsx", "utf8");
    const contact = page.slice(page.indexOf('id="contact"'));
    expect(contact).toContain('href={`tel:${c.phoneE164}`} className="font-semibold underline underline-offset-4"');
    expect(contact).not.toMatch(/text-xl font-extrabold underline/);
    expect(contact).toContain("{c.serviceArea.main}");
    expect(contact).not.toMatch(/Call to check your area/);
    expect(page).toContain("md:items-center");
  });
});

describe("delivery fee wording", () => {
  it("delivery is always described as an additional fee, never free, with no amount", async () => {
    const { DELIVERY_FEE_NOTE, DELIVERY_FEE_SHORT, WHY } = await import("@/lib/site-copy");
    expect(DELIVERY_FEE_NOTE).toBe("Delivery available for an additional fee. Call for pricing.");
    expect(DELIVERY_FEE_SHORT).toBe("Delivery fee applies, call for pricing.");
    expect(WHY).toContain("Delivery arrangements for an additional fee");
    expect(WHY).toContain("Options for all types of events");
    expect(WHY).not.toContain("Options for different types of events");
    expect(WHY).toContain("Friendly customer service");
    expect(WHY).not.toContain("Professional customer service");
    const files = ["src/app/page.tsx", "src/lib/site-copy.ts", "src/app/terms/page.tsx", "src/components/site/SiteFooter.tsx"];
    for (const f of files) {
      const t = readFileSync(f, "utf8");
      expect(t, f).not.toMatch(/free delivery|delivery (is )?free|free of charge|no delivery fee|includes delivery/i);
      expect(t, f).not.toMatch(/delivery[^.\n]{0,40}\$\d/i);
    }
    const page = readFileSync("src/app/page.tsx", "utf8");
    expect(page).toContain("fee applies");
    expect(page).toContain("Delivery available for an additional fee");
    expect(page.match(/DELIVERY_FEE_NOTE/g)!.length).toBeGreaterThanOrEqual(3); // import + How It Works + Service Area
  });
});
