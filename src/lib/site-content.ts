import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { config } from "@/lib/config";
import { SERVICE_AREA } from "@/lib/site-copy";
import { getSettings } from "@/lib/settings";
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
};

/** Website content keys in app_settings (edited from /admin/website). */
export const SITE_KEYS = {
  logoUrl: "site.logoUrl",
  hours: "site.hours",
  email: "site.email",
} as const;

export function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const DEFAULT_CATEGORIES = [
  { id: 1, name: "Jumping Balloons", description: "Bring excitement to your event with our jumping balloon rentals. Perfect for parties, celebrations, school events, and special occasions.", },
  { id: 2, name: "Laser Tag and Inflatable Mazes", description: "Create an unforgettable experience with our laser tag and inflatable maze attractions. A great addition to events, parties, and group activities.", },
  { id: 3, name: "Paddle Boats", description: "Add something special to your event with our paddle boat rentals. An exciting attraction for outdoor events and special occasions.", },
];

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
    email: str(settings.get(SITE_KEYS.email)) ?? config.publicEmail,
    phoneDisplay: config.hotlineDisplay,
    phoneE164: config.hotlineE164,
    categories: cats,
  };
}
