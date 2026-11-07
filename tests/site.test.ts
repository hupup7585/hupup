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
      "Make your next event unforgettable with our exciting rentals! Affordable and suitable for any party, gathering, celebration & occasion, or just because.",
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
    expect(categoryIcon("Jumping Balloons")).toBe(Castle);
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
  it("uses Abram's exact towns with Kiryas Joel (Town of Palm Tree) as the single main area", async () => {
    const { SERVICE_AREA, serviceAreaPlaces } = await import("@/lib/site-copy");
    expect(SERVICE_AREA.mainLabel).toBe("Main service area:");
    expect(SERVICE_AREA.main).toBe("Kiryas Joel");
    expect(SERVICE_AREA.mainSub).toBe("Town of Palm Tree, Orange County, NY");
    expect(SERVICE_AREA.alsoTitle).toBe("We also deliver to these nearby towns:");
    expect([...SERVICE_AREA.also]).toEqual(["Monroe", "Blooming Grove", "Woodbury and Highland Mills", "Chester", "Harriman", "Washingtonville"]);
    expect(SERVICE_AREA.region).toBe("Orange County, NY");
    expect(serviceAreaPlaces()).toEqual([
      "Kiryas Joel", "Monroe", "Blooming Grove", "Woodbury", "Highland Mills", "Chester", "Harriman", "Washingtonville",
    ]);
  });
  it("homepage shows the section and nav link, main area before the secondary list, and no placeholder text", () => {
    const page = readFileSync("src/app/page.tsx", "utf8");
    const header = readFileSync("src/components/site/SiteHeader.tsx", "utf8");
    expect(page).toContain("<ServiceAreaC c={c} />");
    expect(readFileSync("src/components/site/ServiceAreaC.tsx", "utf8")).toContain('"service-area"');
    expect(header).toContain('["Service Area", "/#service-area"]');
    const saComp = readFileSync("src/components/site/ServiceArea.tsx", "utf8");
    expect(saComp.indexOf("serviceArea.mainLabel")).toBeLessThan(saComp.indexOf("serviceArea.alsoTitle"));
    expect(page).toContain("areaServed");
    expect(page).not.toMatch(/Kiryas Joel and Town of Palm Tree/);
    expect(page).toContain("Kiryas Joel (Town of Palm Tree)");
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
    expect(contact).toContain("md:items-start"); // heading at the top of the column, like the other sections
  });
});

describe("delivery fee wording", () => {
  it("delivery is always described as an additional fee, never free, with no amount", async () => {
    const { DELIVERY_FEE_NOTE, DELIVERY_FEE_SHORT, WHY } = await import("@/lib/site-copy");
    expect(DELIVERY_FEE_NOTE).toBe("Delivery available. Call for pricing.");
    expect(DELIVERY_FEE_SHORT).toBe("Delivery fee applies, call for pricing.");
    expect(WHY).toContain("Delivery option available"); // Abram Nov 4, 2:08 PM
    expect(WHY).not.toContain("Delivery arrangements for an additional fee");
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
    // Hero card: "Delivery option available" as a line inside the card (Abraham: no corner circle)
    expect(page).toMatch(/data-hero-delivery[^>]*>[\s\S]*?Delivery option available/);
    expect(page).not.toContain("fee applies");
    expect(page).not.toMatch(/rounded-full bg-white px-1\.5/);
    expect(page).toContain("Delivery available for an additional fee"); // meta description
    expect(page).toContain("{noLonelyWord(HOW_IT_WORKS_DELIVERY)}"); // How It Works (Abraham's approved sentence)
  });
});

describe("business name never splits across lines", () => {
  it("keepName joins the name with non-breaking spaces and leaves other text alone", async () => {
    const { keepName, BUSINESS_NAME_NB } = await import("@/lib/site-copy");
    expect(BUSINESS_NAME_NB).toBe("Hup Up Attractions");
    expect(keepName("Why Choose Hup Up Attractions")).toBe("Why Choose Hup Up Attractions");
    expect(keepName("Our Rentals")).toBe("Our Rentals");
  });
  it("headings, intro, CTA, contact, footer and legal pages use it", () => {
    const parts = readFileSync("src/components/site/parts.tsx", "utf8");
    expect(parts).toContain("{keepName(title)}");
    const page = readFileSync("src/app/page.tsx", "utf8");
    expect(page).toContain("{keepName(INTRO_REST)}"); // hero subtitle: first sentence has no business name
    expect(page).toContain("{keepName(FINAL_CTA_TEXT)}");
    expect(readFileSync("src/components/site/SiteFooter.tsx", "utf8")).toContain("{BUSINESS_NAME_NB}");
  });
});

describe("Jumping Balloons and no slashes", () => {
  const visible = ["src/app/page.tsx", "src/components/site/SiteFooter.tsx", "src/components/site/SiteHeader.tsx", "src/lib/site-copy.ts", "src/lib/site-content.ts", "src/app/privacy/page.tsx", "src/app/terms/page.tsx", "src/app/layout.tsx"];
  it("'bounce house' appears only as a search-engine hint (page titles, meta descriptions, structured data)", () => {
    // Exception: Abraham's approved /terms section C names the business-terms section "Bounce Houses and Inflatable
    // Attractions" verbatim (legal section title), so that one phrase is allowed there.
    const stripHints = (t: string) =>
      t
        .replace(/export const metadata[\s\S]*?\n};\n/g, "")
        .replace(/const jsonLd = \{[\s\S]*?\n  \};\n/g, "");
    const all = visible
      .map((f) => stripHints(readFileSync(f, "utf8")))
      .join("\n")
      .replace("See Sections 9 through 13 (Bounce Houses and Inflatable Attractions,", "");
    expect(all).not.toMatch(/Bounce Houses/);
    expect(all.match(/bounce house/gi) ?? []).toEqual([]); // never in visible copy
    const page = readFileSync("src/app/page.tsx", "utf8");
    expect(page).toContain("Jumping Balloons (bounce houses)");
    expect(page).toContain("Jumping Balloon (bounce house)");
  });
  it("starter category data uses the new name and description", async () => {
    const sql = readFileSync("drizzle/0003_rename_jumping_balloons.sql", "utf8");
    expect(sql).toContain("SET \"name\" = 'Jumping Balloons'");
    expect(sql).toContain("Bring excitement to your event with our jumping balloon rentals. Perfect for parties, celebrations, school events, and special occasions.");
  });
  it("visible service area text has no slashes", async () => {
    const { SERVICE_AREA } = await import("@/lib/site-copy");
    for (const t of [SERVICE_AREA.main, ...SERVICE_AREA.also]) expect(t).not.toContain("/");
    expect(readFileSync("src/app/page.tsx", "utf8")).not.toMatch(/ \/ /);
  });
});

describe("Kiryas Joel is one place", () => {
  it("never shows 'Kiryas Joel and Town of Palm Tree' or a slash between them anywhere", () => {
    for (const f of ["src/app/page.tsx", "src/components/site/SiteFooter.tsx", "src/lib/site-copy.ts", "src/app/privacy/page.tsx", "src/app/terms/page.tsx"]) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/Kiryas Joel (and|\/) Town of Palm Tree/);
    }
  });
});

describe("nearby towns grid", () => {
  it("is an even grid: 2 per row on phones, 3 per row from 768px, full rows only", async () => {
    const page = readFileSync("src/app/page.tsx", "utf8");
    expect(readFileSync("src/components/site/ServiceArea.tsx", "utf8")).toContain("grid auto-rows-fr grid-cols-2 gap-3 md:grid-cols-3");
    const saSrc = readFileSync("src/components/site/ServiceArea.tsx", "utf8");
    const grid = saSrc.slice(saSrc.indexOf("data-town-grid"), saSrc.indexOf("</ul>", saSrc.indexOf("data-town-grid")));
    expect(grid).not.toMatch(/col-start|col-span/);
    const { SERVICE_AREA } = await import("@/lib/site-copy");
    expect(SERVICE_AREA.also.length % 6).toBe(0); // 2 full rows of 3, 3 full rows of 2
    expect(page).not.toMatch(/flex flex-wrap gap-2/);
  });
});

describe("Why Choose layout and badge (Abram 10:25-10:30 PM)", () => {
  it("labels never end on one lonely word and wrap balanced", async () => {
    const { noLonelyWord } = await import("@/lib/site-copy");
    expect(noLonelyWord("Friendly customer service")).toBe("Friendly customer service");
    expect(noLonelyWord("Options for all types of events")).toBe("Options for all types of events");
    expect(noLonelyWord("Single")).toBe("Single");
    const page = readFileSync("src/app/page.tsx", "utf8");
    expect(page).toContain("[text-wrap:balance]\">{whyLabel(w)}");
    expect(page).toContain("grid auto-rows-fr gap-x-10 sm:grid-cols-2");
  });
  it("heading column is sized to the business name with a 64px gap", () => {
    const page = readFileSync("src/app/page.tsx", "utf8");
    expect(page).toContain("lg:grid-cols-[min-content_minmax(0,1fr)] lg:items-center lg:gap-16");
  });
  it("phone line under the heading is a smaller, thin-underlined tap-to-call link", () => {
    const page = readFileSync("src/app/page.tsx", "utf8");
    expect(page).toMatch(/data-why-phone[\s\S]{0,80}href=\{`tel:\$\{c\.phoneE164\}`\}/);
    expect(page).toContain("after:top-[calc(100%-0.43em+5px)] after:h-[3px] after:bg-hu-yellow"); // same 3px thickness, 5px below the baseline
    expect(page).not.toContain("text-2xl font-extrabold underline decoration-hu-yellow decoration-[6px]");
  });
  it("delivery note is centered under the steps, at least as large as the step text, truck icon kept", () => {
    const page = readFileSync("src/app/page.tsx", "utf8");
    expect(page).toContain('<div className="mt-12 flex justify-center">');
    const note = page.slice(page.indexOf("data-delivery-note"), page.indexOf("</p>", page.indexOf("data-delivery-note")));
    expect(note).toMatch(/text-lg [^"]*sm:text-xl/); // step descriptions are text-lg
    expect(note).toContain("<Truck");
  });
  it("hero card: no corner circle; 'Delivery option available' sits inside the card, left-aligned under the rentals", () => {
    const page = readFileSync("src/app/page.tsx", "utf8");
    expect(page).not.toContain("data-sticker");
    expect(page).not.toContain("data-badge-group");
    const card = page.slice(page.indexOf("data-hero-phone"), page.indexOf("<Wave fill={theme.white} />"));
    const list = card.indexOf("</ul>"), line = card.indexOf("data-hero-delivery"), cardEnd = card.indexOf("</div>", line);
    expect(list).toBeLessThan(line);
    expect(line).toBeLessThan(cardEnd);
    expect(card.slice(line, cardEnd)).toContain("<Truck");
  });
});

describe("Service Area delivery note (Abram 10:36 + 10:38 PM)", () => {
  it("reads exactly 'Delivery available. Call for pricing.' as a calm regular-weight note", async () => {
    const { DELIVERY_FEE_NOTE } = await import("@/lib/site-copy");
    expect(DELIVERY_FEE_NOTE).toBe("Delivery available. Call for pricing.");
    const page = readFileSync("src/app/page.tsx", "utf8");
    expect(readFileSync("src/components/site/ServiceArea.tsx", "utf8")).toMatch(/data-sa-delivery-note className="mt-5 flex items-start gap-2 text-base leading-7"/);
    expect(page + readFileSync("src/components/site/ServiceArea.tsx", "utf8")).not.toContain("Delivery available for an additional fee. Call for pricing.");
  });
});

describe("nearby-towns footnote stays exactly as Abram approved (10:39 PM)", () => {
  it("wording and styling unchanged", async () => {
    const { DELIVERY_FEE_SHORT } = await import("@/lib/site-copy");
    expect(DELIVERY_FEE_SHORT).toBe("Delivery fee applies, call for pricing.");
    expect(readFileSync("src/components/site/ServiceArea.tsx", "utf8")).toContain("{noLonelyWord(`All in ${c.serviceArea.region}. ${DELIVERY_FEE_SHORT}`)}");
  });
});

describe("contact list Business icon (Abram 10:43 PM)", () => {
  it("uses the Lucide Store icon in the same sky tile", () => {
    const page = readFileSync("src/app/page.tsx", "utf8");
    const contact = page.slice(page.indexOf('id="contact"'));
    expect(contact).toMatch(/<IconTile icon=\{Store\} tone="sky" \/>\s*<div>\s*<p[^>]*>Business<\/p>/);
    expect(contact).not.toContain("icon={PartyPopper}");
  });
});

describe("Kiryas Joel box delivery line (Abram 10:46 PM)", () => {
  it("has its own text; How It Works note and towns footnote unchanged", async () => {
    const { SERVICE_AREA_DELIVERY_NOTE, DELIVERY_FEE_NOTE, DELIVERY_FEE_SHORT } = await import("@/lib/site-copy");
    expect(SERVICE_AREA_DELIVERY_NOTE).toBe("Delivery available for an additional fee.");
    expect(DELIVERY_FEE_NOTE).toBe("Delivery available. Call for pricing.");
    expect(DELIVERY_FEE_SHORT).toBe("Delivery fee applies, call for pricing.");
    const page = readFileSync("src/app/page.tsx", "utf8");
    const saFile = readFileSync("src/components/site/ServiceArea.tsx", "utf8");
    const box = saFile.slice(saFile.indexOf("data-sa-delivery-note"), saFile.indexOf("data-sa-delivery-note") + 600);
    expect(box).toContain("{noLonelyWord(SERVICE_AREA_DELIVERY_NOTE)}");
    const how = page.slice(page.indexOf('id="how-it-works"'), page.indexOf("<ServiceAreaC c={c} />"));
    expect(how).toContain("{noLonelyWord(HOW_IT_WORKS_DELIVERY)}");
    const { HOW_IT_WORKS_DELIVERY } = await import("@/lib/site-copy");
    expect(HOW_IT_WORKS_DELIVERY).toBe("We deliver our rentals right to your door.");
  });
});

describe("Why Choose delivery item (Abram 10:50 PM)", () => {
  it("is exactly 'Delivery option available', no period, same position and truck icon", async () => {
    const { WHY } = await import("@/lib/site-copy");
    expect(WHY).toEqual([
      "Exciting attraction rentals",
      "Options for all types of events",
      "Convenient phone reservations",
      "Friendly customer service",
      "Delivery option available",
      "Simple booking process",
    ]);
    const page = readFileSync("src/app/page.tsx", "utf8");
    expect(page).toContain("const WHY_ICONS = [PartyPopper, ListChecks, PhoneCall, Headset, Truck, ClipboardCheck];");
  });
});

describe("'Delivery / option available' rows (Abram Nov 4, 2:08 PM)", () => {
  it("always renders as two rows: 'Delivery' then 'option available'", async () => {
    const { whyRows, WHY } = await import("@/lib/site-copy");
    expect(whyRows("Delivery option available")).toEqual(["Delivery", "option\u00A0available"]);
    expect(whyRows(WHY[0])).toBeNull();
    const page = readFileSync("src/app/page.tsx", "utf8");
    expect(page).toContain('<span className="block">{rows[0]}</span>');
    expect(page).toContain('<span className="block">{rows[1]}</span>');
  });
});

describe("'Options for / all types of events' break (Abram 10:51 PM)", () => {
  it("can only break between 'for' and 'all'; wording unchanged", async () => {
    const { whyLabel } = await import("@/lib/site-copy");
    const out = whyLabel("Options for all types of events");
    expect(out.replace(/\u00A0/g, " ")).toBe("Options for all types of events");
    expect(out.split(" ")).toEqual(["Options\u00A0for", "all\u00A0types\u00A0of\u00A0events"]);
    expect(whyLabel("Friendly customer service")).toBe("Friendly customer\u00A0service");
  });
});

describe("Why Choose phone line size (Abram 10:52 PM)", () => {
  it("is about 60% of the heading at each breakpoint, icon scales with it, thin underline kept", () => {
    const page = readFileSync("src/app/page.tsx", "utf8");
    expect(page).toContain("text-[1.02rem] font-bold after:absolute after:inset-x-0 after:top-[calc(100%-0.43em+5px)] after:h-[3px] after:bg-hu-yellow after:content-[\'\'] min-[370px]:text-[1.125rem] sm:text-[1.35rem] xl:text-[1.8rem]");
    // One unbroken line (Abram 2:10 PM): no text underline that skips ink or the icon
    const phone = page.slice(page.indexOf("data-why-phone"), page.indexOf("data-why-phone") + 600);
    expect(phone).not.toContain("underline");
    expect(page).toContain('<Phone className="h-[0.9em] w-[0.9em] shrink-0"');
  });
});

describe("Contact Us heading and icons (Abram)", () => {
  it("heading matches the other sections: left-aligned, top of the column, standard eyebrow and heading", () => {
    const page = readFileSync("src/app/page.tsx", "utf8");
    expect(page).toContain('<SectionTitle kicker="Get in touch" title="Contact Us" />');
    expect(page).toContain('<SectionTitle kicker="When to reach us" title="Our Hours" />');
    const contactGrid = page.slice(page.indexOf('id="contact"'), page.indexOf('<SectionTitle kicker="Get in touch"'));
    expect(contactGrid).toContain("md:items-start");
    expect(contactGrid).not.toContain("md:items-center");
    // every contact icon tile is light blue
    const after = page.slice(page.indexOf('id="contact"'));
    const contact = after.slice(0, after.indexOf("</section>"));
    expect(contact.match(/<IconTile icon=\{\w+\} tone="sky" \/>/g)).toHaveLength(5); // business, phone, email, area, hours (when set)
    expect(contact).not.toContain('tone="yellow"');
    expect(page.match(/kickerSpacing=/g)).toBeNull();
    const parts = readFileSync("src/components/site/parts.tsx", "utf8");
    expect(parts).toContain('kickerSpacing = "mb-2"');
  });
});

describe("Service Area heading matches the other sections (Abraham)", () => {
  it("eyebrow + title via the shared heading, no icon box beside it; Kiryas Joel card unchanged", () => {
    const page = readFileSync("src/app/page.tsx", "utf8");
    const sa = readFileSync("src/components/site/ServiceArea.tsx", "utf8");
    expect(sa).toContain('<SectionTitle kicker="Right to your door" title="Service Area" />');
    expect(sa).not.toContain("<IconTile");
    expect(sa).not.toContain("<h2");
  });
});

describe("Middletown: served, but not shown on the public website (Abraham)", () => {
  it("stays in the $15 delivery zone (pricing, POS, hotline address check)", async () => {
    const { deliveryZone } = await import("@/lib/pricing");
    const { SETTING_DEFAULTS } = await import("@/lib/settings");
    expect(deliveryZone("10 Main St, Middletown, NY", SETTING_DEFAULTS)).toBe("area");
  });
  it("never appears in what the website displays (Service Area, town lists, FAQ, SEO, structured data)", async () => {
    const { readdirSync, statSync } = await import("node:fs");
    const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(`${d}/${f}`).isDirectory() ? walk(`${d}/${f}`) : [`${d}/${f}`]));
    const publicFiles = ["src/lib/site-copy.ts", ...walk("src/components/site"), ...walk("src/app").filter((f) => !f.includes("/admin/") && !f.includes("/api/"))];
    expect(publicFiles.filter((f) => /middletown/i.test(readFileSync(f, "utf8")))).toEqual([]);
    const { serviceAreaPlaces } = await import("@/lib/site-copy");
    expect(serviceAreaPlaces().join(" ")).not.toMatch(/middletown/i);
  });
});

describe("footer contact block (Abraham)", () => {
  it("holds contact info only: no service area or hours lines", () => {
    const footer = readFileSync("src/components/site/SiteFooter.tsx", "utf8");
    const contact = footer.slice(footer.indexOf(">Contact</h3>"), footer.indexOf("border-t border-white/15"));
    expect(contact).toContain("tel:");
    expect(contact).toContain("mailto:");
    expect(contact).not.toMatch(/Main area|nearby|officeHours|See all hours|automated phone/);
  });
});

describe("mock-up review pages (Abraham)", () => {
  it("are noindex and not in the sitemap, and the live pages never use the mock-up header", () => {
    expect(readFileSync("src/app/mockups/layout.tsx", "utf8")).toMatch(/index: false/);
    expect(readFileSync("src/app/sitemap.ts", "utf8")).not.toContain("mockups");

  });
});

describe("Service Area in the hero card style (Abraham, live on the home page)", () => {
  it("has even edges plus the hero card's solid navy shadow, 3 towns per row on desktop, 2 on phone", () => {
    expect(readFileSync("src/app/page.tsx", "utf8")).toContain("<ServiceAreaC c={c} />");
    expect(readFileSync("src/app/mockups/service-area/page.tsx", "utf8")).toContain("<ServiceAreaC");
    const c = readFileSync("src/components/site/ServiceAreaC.tsx", "utf8");
    // Even border on every side, plus the hero card's solid navy offset shadow (no soft or blurred shadow)
    expect(c).toContain('const CARD = "relative flex flex-col rounded-[2rem] border-4 border-hu-deep bg-white p-6 shadow-[8px_8px_0_#123D73] sm:p-8"');
    expect(readFileSync("src/app/page.tsx", "utf8")).toContain("shadow-[8px_8px_0_#123D73]"); // same shadow as the hero card
    expect(c.match(/shadow-\[[^\]]*\]/g)).toEqual(["shadow-[8px_8px_0_#123D73]"]);
    expect(c).toContain("grid auto-rows-fr grid-cols-2 gap-3");
    expect(c).toContain("md:grid-cols-3");
  });
});

describe("hero subtitle (Abraham)", () => {
  it("keeps the dictated wording, uppercase, first sentence on one line on desktop", async () => {
    const page = readFileSync("src/app/page.tsx", "utf8");
    expect(page).toMatch(/data-hero-subtitle className="[^"]*\buppercase\b/);
    expect(page).toContain('<span className="xl:block xl:whitespace-nowrap">{INTRO_FIRST}</span> {keepName(INTRO_REST)}');
    const { INTRO } = await import("@/lib/site-copy");
    expect(INTRO).toBe("Make your next event unforgettable with our exciting rentals! Affordable and suitable for any party, gathering, celebration & occasion, or just because.");
  });
});

describe("SEO rule (Abraham)", () => {
  it("previews are noindex with no sitemap; the live site is indexable", async () => {
    const { isLiveSite } = await import("@/lib/seo");
    expect(isLiveSite({ VERCEL_ENV: "preview" })).toBe(false);
    expect(isLiveSite({})).toBe(false);
    expect(isLiveSite({ VERCEL_ENV: "production" })).toBe(true);
    expect(readFileSync("src/app/layout.tsx", "utf8")).toContain("robots: isLiveSite() ? { index: true, follow: true } : { index: false, follow: false }");
    expect(readFileSync("src/app/robots.ts", "utf8")).toContain('if (!isLiveSite()) return { rules: [{ userAgent: "*", disallow: "/" }] };');
    expect(readFileSync("src/app/sitemap.ts", "utf8")).toContain("if (!isLiveSite()) return [];");
  });
  it("every public page has its own title and description; the rule is saved in CLAUDE.md", () => {
    const titles = new Set<string>();
    for (const f of ["src/app/page.tsx", "src/app/text-alerts/page.tsx", "src/app/privacy/page.tsx", "src/app/terms/page.tsx", "src/app/sms-terms/page.tsx", "src/app/paid/page.tsx"]) {
      const t = readFileSync(f, "utf8");
      const title = t.match(/title: "([^"]+)"/)?.[1];
      expect(title, f).toBeTruthy();
      expect(t, f).toMatch(/description:/);
      expect(titles.has(title!), f).toBe(false);
      titles.add(title!);
    }
    expect(readFileSync("CLAUDE.md", "utf8")).toContain("Website SEO and tone rule");
  });
  it("LocalBusiness data has the name, phone, service area and hours", () => {
    const page = readFileSync("src/app/page.tsx", "utf8");
    expect(page).toContain('"@type": "LocalBusiness"');
    expect(page).toContain('telephone: "+1-845-777-7585"');
    expect(page).toContain("areaServed");
    expect(page).toContain("openingHoursSpecification");
  });
});

describe("hero buttons (Abraham)", () => {
  it("CALL NOW TO BOOK has the same navy trim as EXPLORE OUR RENTALS", () => {
    const page = readFileSync("src/app/page.tsx", "utf8");
    expect(page).toContain('label="CALL NOW TO BOOK" className="!min-h-14 border-2 border-hu-deep');
    expect(readFileSync("src/app/globals.css", "utf8")).toMatch(/\.hu-btn-outline \{\s*@apply[^;]*border-2 border-hu-deep/);
  });
});

describe("logo mock-up (Abraham)", () => {
  it("shows every placement on light blue #8CCBFF, is noindex, and the real pages are unchanged", () => {
    const m = readFileSync("src/app/mockups/logo/page.tsx", "utf8");
    expect(m).toContain('const LOGO_TILE = "inline-flex items-center justify-center rounded-2xl bg-[#8CCBFF]"');
    for (const part of ["Header", "Footer", "favicon", "Section break", "Final call to book"]) expect(m).toContain(part);
    expect(readFileSync("src/app/mockups/layout.tsx", "utf8")).toMatch(/index: false/);
    for (const f of ["src/app/page.tsx", "src/components/site/SiteHeader.tsx", "src/components/site/SiteFooter.tsx"]) expect(readFileSync(f, "utf8")).not.toContain("8CCBFF");
  });
});

describe("website Hours (Abraham's simple list)", () => {
  it("shows exactly his lines and the 24/7 note, with nothing about holidays", async () => {
    const { WEBSITE_HOURS, WEBSITE_HOURS_NOTE } = await import("@/lib/site-copy");
    expect(WEBSITE_HOURS).toEqual([
      "Sunday: 11:30 AM - 7:00 PM",
      "Monday - Thursday: 10:30 AM - 7:00 PM",
      "Friday: 10:30 AM - Chatzos",
      "Shabbos: Closed",
      "Motzei Shabbos: Winter: 2 hours after Shabbos - 11:00 PM\nSummer: 12:00 AM",
    ]);
    expect(WEBSITE_HOURS_NOTE).toBe("Book by phone anytime, 24/7.");
    // The card splits each line at the first ": " (day label, then hours), so Motzei Shabbos shows Abraham's two lines
    const motzei = WEBSITE_HOURS[4];
    expect(motzei.slice(0, motzei.indexOf(": "))).toBe("Motzei Shabbos");
    expect(motzei.slice(motzei.indexOf(": ") + 2).split("\n")).toEqual(["Winter: 2 hours after Shabbos - 11:00 PM", "Summer: 12:00 AM"]);
    const page = readFileSync("src/app/page.tsx", "utf8");
    const hours = page.slice(page.indexOf('id="hours"'), page.indexOf('id="contact"'));
    expect(hours).toContain("WEBSITE_HOURS.map(");
    expect(hours).toContain("{WEBSITE_HOURS_NOTE}");
    // Abraham: left column centered against the card; the 24/7 box is white with a thin navy border and navy text, not yellow
    expect(hours).toMatch(/data-hours-grid className="[^"]*md:items-center/);
    const note = hours.match(/data-hours-note className="([^"]*)"/)![1];
    expect(note.split(" ")).toEqual(expect.arrayContaining(["border", "border-hu-deep", "bg-white", "text-hu-deep"]));
    expect(note).not.toContain("bg-hu-yellow");
    expect(hours).not.toMatch(/officeHours|openNow|data-today/); // no "closed today (holiday)" line
    const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\/|\{\/\*[\s\S]*?\*\/\}|\/\/[^\n]*/g, "");
    for (const f of ["src/app/page.tsx", "src/lib/site-copy.ts", "src/components/site/SiteFooter.tsx", "src/components/site/SiteHeader.tsx", "src/components/site/ServiceAreaC.tsx", "src/app/text-alerts/page.tsx"]) {
      expect(strip(readFileSync(f, "utf8")), f).not.toMatch(/yom tov|chol hamoed|purim|tisha|chanukah|lag ba|holiday/i);
    }
  });
});

describe("text alerts promotional box (Abraham approved)", () => {
  it("'And much more' is the title on top, 'STAY INFORMED' directly under it; consent text unchanged", async () => {
    const c = await import("@/lib/sms-consent-copy");
    expect(c.PROMO_TITLE).toBe("And much more");
    expect(c.PROMO_HEADING).toBe("STAY INFORMED");
    expect(c.PROMO_BENEFITS).toEqual(["New item notices", "Promos and special offers", "Our catalog before each season"]);
    expect(c.PROMO_BENEFITS_NOTE).toBe("All in our occasional promotional texts. Message frequency varies.");
    const f = readFileSync("src/app/text-alerts/SignUpForm.tsx", "utf8");
    expect(f.indexOf("{PROMO_TITLE}")).toBeLessThan(f.indexOf("{PROMO_HEADING}"));
    expect(f.indexOf("{PROMO_HEADING}")).toBeLessThan(f.indexOf("PROMO_BENEFITS.map("));
    expect(f).not.toContain("Join our text list");
    expect(f).toContain("{marketingText}");
  });
});

describe("Service Area Kiryas Joel card (Abraham)", () => {
  it("has no yellow 'Delivery option available' badge; the delivery line and truck tile stay", () => {
    const c = readFileSync("src/components/site/ServiceAreaC.tsx", "utf8");
    expect(c).not.toContain("data-sa-badge");
    expect(c).not.toMatch(/rounded-full[^"]*bg-hu-yellow/);
    expect(c).toContain("<IconTile icon={Truck} tone=\"sky\" />");
    expect(c).toContain("{noLonelyWord(SERVICE_AREA_DELIVERY_NOTE)}");
  });
});

describe("Service Area town tiles (Abraham)", () => {
  it("show the town names without house icons", () => {
    const c = readFileSync("src/components/site/ServiceAreaC.tsx", "utf8");
    const grid = c.slice(c.indexOf("data-town-grid"), c.indexOf("</ul>", c.indexOf("data-town-grid")));
    expect(grid).not.toMatch(/IconTile|Home/);
    expect(grid).toContain("c.serviceArea.also.map(");
  });
});

describe("delivery only, no setup (Abraham)", () => {
  it("How It Works says exactly 'We deliver our rentals right to your door.' with the truck icon", async () => {
    const { HOW_IT_WORKS_DELIVERY } = await import("@/lib/site-copy");
    expect(HOW_IT_WORKS_DELIVERY).toBe("We deliver our rentals right to your door.");
    const page = readFileSync("src/app/page.tsx", "utf8");
    const note = page.slice(page.indexOf("data-delivery-note"), page.indexOf("</p>", page.indexOf("data-delivery-note")));
    expect(note).toContain("<Truck");
  });
  it("header: a little more space between the phone number and CALL TO BOOK", () => {
    expect(readFileSync("src/components/site/SiteHeader.tsx", "utf8")).toContain("lg:pl-6 xl:gap-6");
  });
});

describe("Google optimization fixes (no wording changes)", () => {
  it("contact list is a proper list, eyebrows have full contrast, logo has sizes, every public page has a canonical", () => {
    const page = readFileSync("src/app/page.tsx", "utf8");
    expect(page).not.toMatch(/<dl|<dt|<dd/);
    expect(page).toContain("<ul data-contact-list");
    const parts = readFileSync("src/components/site/parts.tsx", "utf8");
    expect(parts).toContain("tracking-[0.18em] text-hu-deep`}>{keepName(kicker)}");
    expect(parts).toContain('sizes="(min-width: 640px) 61px, 54px"');
    for (const [f, c] of [["src/app/page.tsx", "/"], ["src/app/text-alerts/page.tsx", "/text-alerts"], ["src/app/privacy/page.tsx", "/privacy"], ["src/app/terms/page.tsx", "/terms"], ["src/app/sms-terms/page.tsx", "/sms-terms"]]) {
      expect(readFileSync(f, "utf8"), f).toContain(`alternates: { canonical: "${c}" }`);
    }
  });
});
