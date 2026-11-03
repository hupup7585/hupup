import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { config } from "@/lib/config";

export type SiteContent = {
  logoUrl: string | null;
  /** Service area text; null = not set yet (section shows "Call to check your area"). */
  serviceArea: string | null;
  /** Business hours; null = hidden until set. */
  hours: string | null;
  email: string;
  phoneDisplay: string;
  phoneE164: string;
  categories: { id: number; name: string; description: string; slug: string }[];
};

/** Website content keys in app_settings (edited from /admin/website). */
export const SITE_KEYS = {
  logoUrl: "site.logoUrl",
  serviceArea: "site.serviceArea",
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
  { id: 1, name: "Bounce Houses", description: "Bring excitement to your event with our bounce house rentals. Perfect for parties, celebrations, school events, and special occasions.", },
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
    serviceArea: str(settings.get(SITE_KEYS.serviceArea)),
    hours: str(settings.get(SITE_KEYS.hours)),
    email: str(settings.get(SITE_KEYS.email)) ?? config.publicEmail,
    phoneDisplay: config.hotlineDisplay,
    phoneE164: config.hotlineE164,
    categories: cats,
  };
}
