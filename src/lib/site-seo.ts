/**
 * Search listing in Admin (Admin handoff, website Phase W3, Nov 27, 2026): each public page's title and description,
 * the words Google shows for it. Admin settings (All settings, group "Website: search listing"), customer words
 * published only with the Owner's "I approve these exact words". The starting values are exactly today's titles and
 * descriptions, so nothing changes until the Owner publishes a change. The SEO rule stays: a unique title per page with
 * the business name, one description per page, no keyword stuffing.
 */
export const SEO_PAGES = {
  home: {
    path: "/",
    name: "Home page",
    title: "Bounce House & Party Rentals in Kiryas Joel, NY | Hup Up Attractions",
    description:
      "Planning a party in Kiryas Joel (Town of Palm Tree) or Monroe, NY? Hup Up Attractions rents Jumping Balloons (bounce houses), laser tag, inflatable mazes and paddle boats across Orange County, NY. Delivery available for an additional fee. Call (845) 777-7585 to book.",
  },
  privacy: {
    path: "/privacy",
    name: "Privacy Policy page",
    title: "Privacy Policy | Hup Up Attractions",
    description: "How Hup Up Attractions collects, uses and protects your information when you book a party rental by phone or sign up for our texts.",
  },
  terms: {
    path: "/terms",
    name: "Terms and Conditions page",
    title: "Terms and Conditions | Hup Up Attractions",
    description: "The rental terms for bounce houses, laser tag, inflatable mazes and paddle boats from Hup Up Attractions: booking, delivery, safety and payment.",
  },
  smsTerms: {
    path: "/sms-terms",
    name: "Text message terms page",
    title: "SMS Terms | Hup Up Attractions",
    description: "How Hup Up Attractions text messages work: order and service texts, promotional texts, message frequency, and how to reply STOP or HELP.",
  },
  textAlerts: {
    path: "/text-alerts",
    name: "Text updates sign-up page",
    title: "Get Text Updates and Party Rental Deals | Hup Up Attractions",
    description:
      "Join the Hup Up Attractions text list for new rental items, seasonal promos and order updates for your party in Kiryas Joel and Orange County, NY. Message frequency varies. Reply STOP to opt out.",
  },
} as const;
export type SeoPage = keyof typeof SEO_PAGES;
const cap = (p: string) => p[0].toUpperCase() + p.slice(1);
/** The setting names: seoHomeTitle, seoHomeDescription, seoPrivacyTitle, ... */
export const seoKey = (p: SeoPage, part: "Title" | "Description") => `seo${cap(p)}${part}`;
export const SEO_DEFAULTS: Record<string, string> = Object.fromEntries(
  (Object.keys(SEO_PAGES) as SeoPage[]).flatMap((p) => [
    [seoKey(p, "Title"), SEO_PAGES[p].title],
    [seoKey(p, "Description"), SEO_PAGES[p].description],
  ]),
);
export const SEO_KEYS = Object.keys(SEO_DEFAULTS);
export const seoPageOf = (key: string): SeoPage | null => (Object.keys(SEO_PAGES) as SeoPage[]).find((p) => key === seoKey(p, "Title") || key === seoKey(p, "Description")) ?? null;

/** The check for one title or description, in plain English (null = fine). */
export function checkSeo(key: string, v: string): string | null {
  const t = v.replace(/\r/g, "").trim();
  const page = seoPageOf(key);
  if (!page) return "Unknown page.";
  if (!t) return "It cannot be empty.";
  if (/[<>]/.test(t)) return "Plain words only: no < or > signs.";
  if (t.includes("\n")) return "One line only (no line breaks).";
  if (key.endsWith("Title")) {
    if (t.length < 10 || t.length > 75) return `A title is 10 to 75 characters, so Google shows it whole (now ${t.length}).`;
    if (!t.includes("Hup Up Attractions")) return 'Keep the business name "Hup Up Attractions" in the title.';
    const other = (Object.keys(SEO_PAGES) as SeoPage[]).find((p) => p !== page && SEO_PAGES[p].title.toLowerCase() === t.toLowerCase());
    if (other) return `Each page needs its own title: this is the title of the ${SEO_PAGES[other].name}.`;
    return null;
  }
  if (t.length < 50 || t.length > 300) return `A description is 50 to 300 characters (now ${t.length}).`;
  return null;
}

/** The title and description a page uses now: the published values, or the starting ones when none is set or valid. */
export function seoFor(page: SeoPage, s: Record<string, unknown>): { title: string; description: string } {
  const get = (part: "Title" | "Description") => {
    const k = seoKey(page, part);
    const v = s[k];
    return typeof v === "string" && checkSeo(k, v) === null ? v.trim() : part === "Title" ? SEO_PAGES[page].title : SEO_PAGES[page].description;
  };
  return { title: get("Title"), description: get("Description") };
}

/** Page metadata with the published title and description (everything else on the page's metadata stays as it was). */
export async function seoMetadata<T extends object>(page: SeoPage, rest: T): Promise<T & { title: string; description: string }> {
  const { getSettings } = await import("@/lib/settings");
  return { ...rest, ...seoFor(page, (await getSettings()) as unknown as Record<string, unknown>) };
}
