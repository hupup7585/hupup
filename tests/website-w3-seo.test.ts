import { describe, expect, it, vi } from "vitest";

/* Website Phase W3 (Admin handoff, Nov 27, 2026): each public page's title and description (search listing) is an Admin
   setting (customer words), starting exactly as today, published only with "I approve these exact words". In-memory database. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { SEO_KEYS, SEO_PAGES, checkSeo, seoFor, seoKey, type SeoPage } from "@/lib/site-seo";
import { SETTING_DEFAULTS, clearSettingsCache } from "@/lib/settings";
import { configDef } from "@/lib/config-registry";
import { CONFIG_EXPLANATIONS } from "@/lib/config-explanations";
import { publishDraft, saveDraft } from "@/lib/config-versions";

const PAGES = Object.keys(SEO_PAGES) as SeoPage[];

describe("search listing in Admin (W3)", () => {
  it("10 settings (title and description of 5 pages), starting as today's, editable as customer words with explanations", () => {
    expect(SEO_KEYS).toHaveLength(10);
    for (const k of SEO_KEYS) {
      const d = configDef(k)!;
      expect([d.mode, d.wording, d.group], k).toEqual(["edit", true, "Website: search listing"]);
      expect(CONFIG_EXPLANATIONS[k]?.what, k).toBeTruthy();
      expect(CONFIG_EXPLANATIONS[k]?.ifChanged, k).toMatch(/I approve these exact words/);
    }
    for (const p of PAGES) expect(seoFor(p, SETTING_DEFAULTS as never)).toEqual({ title: SEO_PAGES[p].title, description: SEO_PAGES[p].description });
    // every starting value passes its own check
    for (const k of SEO_KEYS) expect(checkSeo(k, (SETTING_DEFAULTS as unknown as Record<string, string>)[k]), k).toBeNull();
  });
  it("checks: business name in every title, each title unique, sensible lengths, plain one-line words", () => {
    const t = seoKey("privacy", "Title");
    expect(checkSeo(t, "Privacy Policy")).toMatch(/Hup Up Attractions/);
    expect(checkSeo(t, SEO_PAGES.terms.title)).toMatch(/Terms and Conditions page/);
    expect(checkSeo(t, "x".repeat(70) + " Hup Up Attractions")).toMatch(/10 to 75/);
    expect(checkSeo(seoKey("home", "Description"), "Too short")).toMatch(/50 to 300/);
    expect(checkSeo(seoKey("home", "Description"), "<script>" + "x".repeat(60))).toMatch(/Plain words/);
    expect(checkSeo(t, "Privacy | Hup Up\nAttractions")).toMatch(/One line/);
    expect(seoFor("privacy", { [t]: "" }).title).toBe(SEO_PAGES.privacy.title); // an invalid stored value never reaches the page
  });
  it("publishing needs the exact-words approval; then the page's metadata carries it (canonical kept)", async () => {
    const k = seoKey("privacy", "Title");
    const v = await saveDraft(k, "Your Privacy | Hup Up Attractions", null, "test of the search listing");
    await expect(publishDraft(k, v.id, null)).rejects.toThrow(/approve the exact words/);
    await publishDraft(k, v.id, null, { approveWords: true });
    clearSettingsCache();
    const m = await (await import("@/app/privacy/page")).generateMetadata();
    expect(m).toMatchObject({ title: "Your Privacy | Hup Up Attractions", description: SEO_PAGES.privacy.description, alternates: { canonical: "/privacy" } });
  });
});
