import { FINAL_CTA_TEXT, FINAL_CTA_TITLE, HOW_IT_WORKS_DELIVERY, INTRO, SERVICE_AREA_DELIVERY_NOTE, SLOGAN, STEPS, WEBSITE_HOURS_NOTE, WHY } from "@/lib/site-copy";

/**
 * Website words in Admin (Admin handoff, website Phase W2, Nov 27, 2026). The home page's own words are Admin settings
 * (All settings, group "Website: home page"), published only with the Owner's "I approve these exact words", with
 * drafts, history and undo. The starting value of each is exactly the wording Abraham approved in src/lib/site-copy.ts,
 * so nothing on the website changes until the Owner publishes a change.
 */
export const SITE_WORD_DEFAULTS = {
  siteSlogan: SLOGAN,
  siteIntro: INTRO,
  /** One line per item of "Why Choose Hup Up Attractions" (1 to 6 lines; each line has its own icon). */
  siteWhyList: WHY.join("\n"),
  siteStep1Word: STEPS[0][1],
  siteStep1Text: STEPS[0][2],
  siteStep2Word: STEPS[1][1],
  siteStep2Text: STEPS[1][2],
  siteStep3Word: STEPS[2][1],
  siteStep3Text: STEPS[2][2],
  siteHowItWorksDelivery: HOW_IT_WORKS_DELIVERY,
  siteHeroDelivery: "Delivery option available",
  siteServiceAreaDeliveryNote: SERVICE_AREA_DELIVERY_NOTE,
  siteFinalCtaTitle: FINAL_CTA_TITLE,
  siteFinalCtaText: FINAL_CTA_TEXT,
  siteHoursNote: WEBSITE_HOURS_NOTE,
} as const;
export type SiteWordKey = keyof typeof SITE_WORD_DEFAULTS;
export const SITE_WORD_KEYS = Object.keys(SITE_WORD_DEFAULTS) as SiteWordKey[];

/** The most characters each one may have (keeps the page layout working on phones). */
export const SITE_WORD_MAX: Record<SiteWordKey, number> = {
  siteSlogan: 60,
  siteIntro: 300,
  siteWhyList: 300,
  siteStep1Word: 20,
  siteStep1Text: 120,
  siteStep2Word: 20,
  siteStep2Text: 120,
  siteStep3Word: 20,
  siteStep3Text: 120,
  siteHowItWorksDelivery: 120,
  siteHeroDelivery: 40,
  siteServiceAreaDeliveryNote: 80,
  siteFinalCtaTitle: 60,
  siteFinalCtaText: 200,
  siteHoursNote: 60,
};

/** The check for one website text, in plain English (null = fine). */
export function checkSiteWords(key: SiteWordKey, v: string): string | null {
  const t = v.replace(/\r/g, "").trim();
  if (!t) return "The website needs words here; it cannot be empty.";
  if (/[<>]/.test(t)) return "Plain words only: no < or > signs.";
  if (t.length > SITE_WORD_MAX[key]) return `Keep it to ${SITE_WORD_MAX[key]} characters or fewer, so it fits the page on phones (now ${t.length}).`;
  if (key === "siteWhyList") {
    const lines = t.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length > 6) return "Up to 6 lines: one per item (each line has its own picture).";
    if (lines.some((l) => l.length > 60)) return "Each line 60 characters or fewer.";
    return null;
  }
  if (t.includes("\n")) return "One line only (no line breaks).";
  return null;
}

export type SiteWords = {
  slogan: string;
  intro: string;
  why: string[];
  steps: [string, string, string][];
  howItWorksDelivery: string;
  heroDelivery: string;
  serviceAreaDeliveryNote: string;
  finalCtaTitle: string;
  finalCtaText: string;
  hoursNote: string;
};

/** The words the website shows now: each published value, or its starting value when none is set or it is not valid. */
export function siteWordsFrom(s: Partial<Record<SiteWordKey, unknown>>): SiteWords {
  const get = (k: SiteWordKey) => {
    const v = s[k];
    return typeof v === "string" && checkSiteWords(k, v) === null ? v.replace(/\r/g, "").trim() : SITE_WORD_DEFAULTS[k];
  };
  return {
    slogan: get("siteSlogan"),
    intro: get("siteIntro"),
    why: get("siteWhyList").split("\n").map((l) => l.trim()).filter(Boolean),
    steps: [
      [STEPS[0][0], get("siteStep1Word"), get("siteStep1Text")],
      [STEPS[1][0], get("siteStep2Word"), get("siteStep2Text")],
      [STEPS[2][0], get("siteStep3Word"), get("siteStep3Text")],
    ],
    howItWorksDelivery: get("siteHowItWorksDelivery"),
    heroDelivery: get("siteHeroDelivery"),
    serviceAreaDeliveryNote: get("siteServiceAreaDeliveryNote"),
    finalCtaTitle: get("siteFinalCtaTitle"),
    finalCtaText: get("siteFinalCtaText"),
    hoursNote: get("siteHoursNote"),
  };
}
