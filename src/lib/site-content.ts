import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { config, publicEmail } from "@/lib/config";
import { SERVICE_AREA } from "@/lib/site-copy";
import { getSettings } from "@/lib/settings";
import { siteWordsFrom, type SiteWords } from "@/lib/site-words";
import { hoursLines, officeOpenNow, todayHours } from "@/lib/business-hours";

async function officeHours(): Promise<SiteContent["officeHours"]> {
  const s = await getSettings();
  return { lines: hoursLines(s), today: todayHours(new Date(), s), openNow: officeOpenNow(new Date(), s), note: s.hoursWebsiteNote };
}

export type SiteContent = {
  logoUrl: string | null;
  serviceArea: { mainLabel: string; main: string; mainSub: string; officialName: string; alsoTitle: string; also: readonly string[]; region: string };
  /** Business hours; null = hidden until set. */
  hours: string | null;
  /** Office hours from the shared business-hours settings (website Hours section and footer). */
  officeHours: { lines: string[]; today: string; openNow: boolean; note: string };
  email: string;
  phoneDisplay: string;
  phoneE164: string;
  categories: { id: number; name: string; description: string; slug: string }[];
  /** The home page's words from Admin (website Phase W2): the published values, starting as Abraham's approved text. */
  words: SiteWords;
};

/** Website content keys in app_settings (edited from /admin/website). */
export const SITE_KEYS = {
  logoUrl: "site.logoUrl",
  hours: "site.hours",
  email: "site.email",
} as const;

export { slugify } from "@/lib/site-defaults";
import { DEFAULT_CATEGORIES, slugify } from "@/lib/site-defaults";

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export async function getSiteContent(): Promise<SiteContent> {
  let settings = new Map<string, unknown>();
  let cats: SiteContent["categories"] = DEFAULT_CATEGORIES.map((c) => ({ ...c, slug: slugify(c.name) }));
  try {
    const rows = await db.select().from(schema.appSettings);
    settings = new Map(rows.map((r) => [r.key, r.value]));
    const dbCats = await db
      .select()
      .from(schema.categories)
      .where(and(eq(schema.categories.active, true)))
      .orderBy(asc(schema.categories.sortOrder), asc(schema.categories.id));
    if (dbCats.length) {
      cats = dbCats.map((c) => ({ id: c.id, name: c.name, description: c.description, slug: slugify(c.name) }));
    }
  } catch (e) {
    console.error("site content: using defaults", e);
  }
  return {
    logoUrl: str(settings.get(SITE_KEYS.logoUrl)),
    serviceArea: SERVICE_AREA,
    hours: str(settings.get(SITE_KEYS.hours)),
    // Office hours from the business-hours settings (same source as the POS and hotline), plus Abraham's note.
    officeHours: await officeHours(),
    email: publicEmail(process.env, str(settings.get(SITE_KEYS.email))),
    phoneDisplay: config.hotlineDisplay,
    phoneE164: config.hotlineE164,
    categories: cats,
    words: siteWordsFrom(await getSettings()),
  };
}
