import { describe, expect, it, vi } from "vitest";

/* Website Phase W2 (Admin handoff, Nov 27, 2026): the home page's words are Admin settings (customer words), starting
   exactly as Abraham's approved text, published only with "I approve these exact words". In-memory database. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { FINAL_CTA_TEXT, FINAL_CTA_TITLE, HOW_IT_WORKS_DELIVERY, INTRO, SERVICE_AREA_DELIVERY_NOTE, SLOGAN, STEPS, WEBSITE_HOURS_NOTE, WHY } from "@/lib/site-copy";
import { SITE_WORD_DEFAULTS, SITE_WORD_KEYS, checkSiteWords, siteWordsFrom } from "@/lib/site-words";
import { SETTING_DEFAULTS, clearSettingsCache, getSettings } from "@/lib/settings";
import { configDef } from "@/lib/config-registry";
import { CONFIG_EXPLANATIONS } from "@/lib/config-explanations";
import { publishDraft, saveDraft } from "@/lib/config-versions";

describe("website words in Admin (W2)", () => {
  it("start exactly as Abraham's approved words, so nothing on the website changes", () => {
    const w = siteWordsFrom(SETTING_DEFAULTS);
    expect(w.slogan).toBe(SLOGAN);
    expect(w.intro).toBe(INTRO);
    expect(w.why).toEqual([...WHY]);
    expect(w.steps).toEqual(STEPS.map((s) => [...s]));
    expect([w.howItWorksDelivery, w.serviceAreaDeliveryNote, w.finalCtaTitle, w.finalCtaText, w.hoursNote, w.heroDelivery]).toEqual([
      HOW_IT_WORKS_DELIVERY,
      SERVICE_AREA_DELIVERY_NOTE,
      FINAL_CTA_TITLE,
      FINAL_CTA_TEXT,
      WEBSITE_HOURS_NOTE,
      "Delivery option available",
    ]);
  });
  it("every one is editable on All settings as customer words, with a plain-English explanation", () => {
    for (const k of SITE_WORD_KEYS) {
      const d = configDef(k)!;
      expect(d, k).toBeTruthy();
      expect([d.mode, d.wording, d.group], k).toEqual(["edit", true, "Website: home page"]);
      expect(CONFIG_EXPLANATIONS[k]?.what, k).toBeTruthy();
      expect(CONFIG_EXPLANATIONS[k]?.ifChanged, k).toMatch(/I approve these exact words/);
      expect((SETTING_DEFAULTS as Record<string, unknown>)[k]).toBe(SITE_WORD_DEFAULTS[k]);
    }
  });
  it("checks: not empty, plain words, fits on phones, one line (the Why list up to 6 lines)", () => {
    expect(checkSiteWords("siteSlogan", "")).toMatch(/cannot be empty/);
    expect(checkSiteWords("siteSlogan", "<b>Hi</b>")).toMatch(/Plain words/);
    expect(checkSiteWords("siteSlogan", "x".repeat(61))).toMatch(/60 characters/);
    expect(checkSiteWords("siteFinalCtaText", "one\ntwo")).toMatch(/One line/);
    expect(checkSiteWords("siteWhyList", "a\nb\nc\nd\ne\nf\ng")).toMatch(/Up to 6 lines/);
    expect(checkSiteWords("siteWhyList", "a\nb")).toBeNull();
    // a stored value that fails the checks never reaches the page: the approved words show instead
    expect(siteWordsFrom({ siteSlogan: "" }).slogan).toBe(SLOGAN);
  });
  it("publishing needs the Owner's approval of the exact words; then the website reads them", async () => {
    const v = await saveDraft("siteHoursNote", "Book by phone any time.", null, "test of website words");
    await expect(publishDraft("siteHoursNote", v.id, null)).rejects.toThrow(/approve the exact words/);
    clearSettingsCache();
    expect(siteWordsFrom(await getSettings()).hoursNote).toBe(WEBSITE_HOURS_NOTE);
    await publishDraft("siteHoursNote", v.id, null, { approveWords: true });
    clearSettingsCache();
    expect(siteWordsFrom(await getSettings()).hoursNote).toBe("Book by phone any time.");
  });
});
