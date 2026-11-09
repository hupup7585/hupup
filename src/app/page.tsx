import type { Metadata } from "next";
import { websiteHoursLines } from "@/lib/business-hours";
import { CalendarCheck, ClipboardCheck, Headset, ListChecks, Mail, MapPin, PartyPopper, Phone, PhoneCall, Search, Store, Truck } from "lucide-react";
import { getSiteContent } from "@/lib/site-content";
import { BUSINESS_NAME_NB, keepName, whyLabel, whyRows, HOW_IT_WORKS_DELIVERY, WEBSITE_HOURS_NOTE, keepTimesTogether, noLonelyWord, FINAL_CTA_TEXT, FINAL_CTA_TITLE, INTRO, SLOGAN, STEPS, WHY, serviceAreaPlaces, SERVICE_AREA_MAP_URL } from "@/lib/site-copy";
import { theme } from "@/lib/theme";
import SiteHeader from "@/components/site/SiteHeader";
import SiteFooter from "@/components/site/SiteFooter";
import ServiceAreaC from "@/components/site/ServiceAreaC";
import { getSettings } from "@/lib/settings";
import { CallButton, ICON_STROKE, IconTile, SectionTitle, Wave, categoryIcon } from "@/components/site/parts";

export const revalidate = 60; // hours and catalog come from Admin; saves also refresh right away

export const metadata: Metadata = {
  title: "Bounce House & Party Rentals in Kiryas Joel, NY | Hup Up Attractions",
  description:
    "Planning a party in Kiryas Joel (Town of Palm Tree) or Monroe, NY? Hup Up Attractions rents Jumping Balloons (bounce houses), laser tag, inflatable mazes and paddle boats across Orange County, NY. Delivery available for an additional fee. Call (845) 777-7585 to book.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Hup Up Attractions | Bounce House, Laser Tag & Paddle Boat Rentals",
    description: "Friendly party rentals for birthdays, schools and celebrations in Kiryas Joel and Orange County, NY. Call (845) 777-7585 to book.",
    type: "website",
    siteName: "Hup Up Attractions",
  },
};


const WHY_ICONS = [PartyPopper, ListChecks, PhoneCall, Headset, Truck, ClipboardCheck];
const STEP_ICONS = [Search, PhoneCall, CalendarCheck];
/** The hero subtitle split after its first sentence (wording unchanged). */
const INTRO_FIRST = INTRO.slice(0, INTRO.indexOf("!") + 1);
const INTRO_REST = INTRO.slice(INTRO.indexOf("!") + 1).trim();

export default async function Home() {
  const c = await getSiteContent();
  const settings = await getSettings();
  const span = (v: string) => v.split("-").map((t) => t.trim());
  const [monOpen, monClose] = span(settings.hoursMonThu);
  const [sunOpen, sunClose] = span(settings.hoursSunday);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: "Hup Up Attractions",
    description:
      "Jumping Balloon (bounce house) rental in Kiryas Joel, plus laser tag, inflatable maze and paddle boat rentals for birthday parties, schools and celebrations across Orange County, NY. Reservations by phone; delivery available for an additional fee.",
    telephone: "+1-845-777-7585",
    email: c.email,
    url: process.env.PUBLIC_BASE_URL || "https://hupup.vercel.app",
    ...(c.logoUrl ? { logo: c.logoUrl } : {}),
    address: { "@type": "PostalAddress", addressLocality: "Kiryas Joel", addressRegion: "NY", addressCountry: "US" },
    areaServed: [
      { "@type": "Place", name: `${c.serviceArea.main}, NY`, alternateName: `${c.serviceArea.officialName}, NY` },
      ...serviceAreaPlaces()
        .slice(1)
        .map((name) => ({ "@type": "Place", name: `${name}, NY` })),
      { "@type": "AdministrativeArea", name: c.serviceArea.region.replace(", NY", ", New York") },
    ],
    // Regular weekly hours (Friday closes at midday and Motzei Shabbos varies, so they're listed in the Hours section).
    openingHoursSpecification: [
      { "@type": "OpeningHoursSpecification", dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday"], opens: monOpen, closes: monClose },
      { "@type": "OpeningHoursSpecification", dayOfWeek: "Sunday", opens: sunOpen, closes: sunClose },
    ],
  };

  return (
    <div id="top" className="font-display text-hu-deep">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <SiteHeader logoUrl={c.logoUrl} phoneDisplay={c.phoneDisplay} phoneE164={c.phoneE164} />

      <main>
        {/* HERO: big type on the left, a bold "call to book" board on the right */}
        <section className="bg-hu-sky">
          <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] items-center gap-10 px-4 pb-8 pt-10 sm:px-6 lg:grid-cols-[1.25fr_1fr] lg:gap-14 lg:pb-12 lg:pt-16">
            <div>
              <span className="hu-sticker -rotate-2">Reservations by phone</span>
              <h1 className="mt-5 text-[2.15rem] min-[360px]:text-[2.5rem] font-extrabold leading-[1.02] tracking-tight sm:text-6xl lg:text-[4.1rem]">{SLOGAN}</h1>
              {/* Abraham's exact wording, shown in uppercase; the first sentence stays on one line on desktop */}
              <p data-hero-subtitle className="mt-5 max-w-xl text-base font-semibold uppercase leading-relaxed min-[400px]:text-[17px] xl:max-w-none xl:text-base">
                <span className="xl:block xl:whitespace-nowrap">{INTRO_FIRST}</span> {keepName(INTRO_REST)}
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                {/* Same navy trim as EXPLORE OUR RENTALS beside it (Abraham) */}
                <CallButton phone={c.phoneE164} label="CALL NOW TO BOOK" className="!min-h-14 border-2 border-hu-deep !px-5 text-lg min-[360px]:!px-8" />
                <a href="#rentals" className="hu-btn-outline !min-h-14 !px-5 text-lg min-[360px]:!px-8">
                  EXPLORE OUR RENTALS
                </a>
              </div>
            </div>

            <div className="relative">
              <div className="rounded-[2rem] border-[3px] border-hu-deep bg-white p-6 shadow-[8px_8px_0_#123D73] sm:p-8">
                <p className="text-sm font-extrabold uppercase tracking-[0.18em] opacity-75">Call to book</p>
                <a data-hero-phone href={`tel:${c.phoneE164}`} className="mt-1 flex items-center gap-3 whitespace-nowrap text-[1.7rem] font-extrabold leading-tight min-[400px]:text-[2rem] sm:text-[2.6rem]">
                  <Phone className="h-7 w-7 shrink-0 sm:h-9 sm:w-9" strokeWidth={ICON_STROKE} aria-hidden />
                  {c.phoneDisplay}
                </a>
                <ul className="mt-6 divide-y-2 divide-hu-deep/10 border-t-2 border-hu-deep/10">
                  {c.categories.map((cat) => (
                    <li key={cat.id}>
                      <a href={`#${cat.slug}`} className="flex items-center gap-4 py-3.5 text-lg font-bold hover:underline">
                        <IconTile icon={categoryIcon(cat.name)} tone="sky" />
                        {cat.name}
                      </a>
                    </li>
                  ))}
                </ul>
                {/* Delivery note inside the card, left-aligned with the rentals (Abraham: no corner circle) */}
                <p data-hero-delivery className="flex items-center gap-4 border-t-2 border-hu-deep/10 pt-3.5 text-base font-semibold text-hu-deep/85">
                  <span className="grid w-12 shrink-0 place-items-center" aria-hidden>
                    <Truck className="h-6 w-6" strokeWidth={ICON_STROKE} />
                  </span>
                  Delivery option available
                </p>
              </div>
            </div>
          </div>
          <Wave fill={theme.white} />
        </section>

        {/* OUR RENTALS: full-width numbered rows (not a card grid) */}
        <section id="rentals" className="scroll-mt-20 bg-white py-14 sm:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionTitle kicker="What we rent" title="Our Rentals" />
            {/* Same faint divider as Hours, Contact and Service Area (Abraham): no strong navy line under the heading */}
            <div className="mt-10 border-t-2 border-hu-deep/10" data-rentals-list>
              {c.categories.map((cat, i) => (
                <article
                  id={cat.slug}
                  key={cat.id}
                  className="grid scroll-mt-24 gap-5 border-b-2 border-hu-deep/15 py-8 sm:grid-cols-[auto_1fr] sm:gap-8 lg:grid-cols-[auto_1fr_auto] lg:items-center lg:py-10"
                >
                  <div className="sm:self-start lg:self-center">
                    <IconTile icon={categoryIcon(cat.name)} tone={i % 2 === 0 ? "yellow" : "sky"} size="lg" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-extrabold leading-tight sm:text-4xl">{cat.name}</h3>
                    <p className="mt-3 max-w-2xl text-lg leading-relaxed text-hu-deep/85">{cat.description}</p>
                  </div>
                  <CallButton phone={c.phoneE164} className="w-full sm:col-start-2 sm:w-fit lg:col-start-auto" />
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* WHY CHOOSE: split layout, icon checklist */}
        <section className="bg-hu-tint py-14 sm:py-20">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[min-content_minmax(0,1fr)] lg:items-center lg:gap-16">
            <div>
              <SectionTitle title="Why Choose Hup Up Attractions" compactLg />
              {/* Secondary line under the heading: 60% of the heading size at every width (Abram 10:52 PM); icon scales with the text; one solid yellow line under icon + number (Abram 2:10 PM) */}
              <a
                data-why-phone
                href={`tel:${c.phoneE164}`}
                className="relative mt-8 inline-flex items-center gap-[0.4em] text-[1.02rem] font-bold after:absolute after:inset-x-0 after:top-[calc(100%-0.43em+5px)] after:h-[3px] after:bg-hu-yellow after:content-[''] min-[370px]:text-[1.125rem] sm:text-[1.35rem] xl:text-[1.8rem]"
              >
                <Phone className="h-[0.9em] w-[0.9em] shrink-0" strokeWidth={ICON_STROKE} aria-hidden />
                {c.phoneDisplay}
              </a>
            </div>
            <ul className="grid auto-rows-fr gap-x-10 sm:grid-cols-2">
              {WHY.map((w, i) => (
                <li key={w} className="flex w-full items-center gap-4 border-b-2 border-hu-deep/10 py-4 text-lg font-semibold">
                  <IconTile icon={WHY_ICONS[i]} tone="white" />
                  {(() => {
                    const rows = whyRows(w);
                    return rows ? (
                      <span data-why-rows className="min-w-0 flex-1">
                        <span className="block">{rows[0]}</span>
                        <span className="block">{rows[1]}</span>
                      </span>
                    ) : (
                      <span className="min-w-0 flex-1 [text-wrap:balance]">{whyLabel(w)}</span>
                    );
                  })()}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* HOW IT WORKS: numbered timeline */}
        <section id="how-it-works" className="scroll-mt-20 bg-white py-14 sm:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionTitle kicker="Booking is easy" title="How It Works" />
            <ol className="relative mt-12 grid gap-10 md:grid-cols-3 md:gap-8">
              <span className="absolute bottom-0 left-[2.2rem] top-0 w-1 rounded bg-hu-sky md:hidden" aria-hidden />
              <span className="absolute left-0 right-0 top-[2.2rem] hidden h-1 rounded bg-hu-sky md:block" aria-hidden />
              {STEPS.map(([step, word, text], i) => {
                const Icon = STEP_ICONS[i];
                return (
                  <li key={step} className="relative flex gap-5 md:block">
                    <span className="relative z-10 grid h-[4.4rem] w-[4.4rem] shrink-0 place-items-center rounded-full border-[3px] border-hu-deep bg-hu-yellow">
                      <Icon className="h-8 w-8" strokeWidth={ICON_STROKE} aria-hidden />
                    </span>
                    <div className="md:mt-5">
                      <p className="text-sm font-extrabold tracking-[0.18em] text-hu-deep/70">{step}</p>
                      <h3 className="text-2xl font-extrabold">{word}</h3>
                      <p className="mt-2 max-w-xs text-lg leading-relaxed text-hu-deep/85">{text}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
            {/* Abraham's delivery sentence: at least as large as the step text, centered under the steps, truck icon kept */}
            <div className="mt-12 flex justify-center">
              <p data-delivery-note className="flex max-w-3xl items-start gap-4 rounded-3xl bg-hu-tint px-5 py-5 text-left text-lg font-semibold leading-relaxed sm:items-center sm:px-7 sm:text-xl">
                <Truck className="mt-1 h-8 w-8 shrink-0 sm:mt-0" strokeWidth={ICON_STROKE} aria-hidden />
                <span className="[text-wrap:pretty]">{noLonelyWord(HOW_IT_WORKS_DELIVERY)}</span>
              </p>
            </div>
          </div>
        </section>

        {/* SERVICE AREA: main area first and prominent, nearby towns clearly secondary */}
        <ServiceAreaC c={c} />

        {/* FINAL CTA */}
        <section className="bg-hu-yellow">
          <div className="mx-auto max-w-4xl px-4 py-16 text-center sm:px-6 sm:py-20">
            <h2 className="text-3xl font-extrabold leading-tight sm:text-5xl">{FINAL_CTA_TITLE}</h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg font-medium sm:text-xl">{keepName(FINAL_CTA_TEXT)}</p>
            <a href={`tel:${c.phoneE164}`} className="mt-8 inline-flex min-h-14 items-center gap-3 rounded-full bg-hu-deep px-9 py-4 text-lg font-bold tracking-wide text-white hover:bg-[#0d2f5a]">
              <Phone className="h-5 w-5" strokeWidth={ICON_STROKE} aria-hidden /> CALL NOW TO BOOK
            </a>
            <p className="mt-4 text-2xl font-extrabold">{c.phoneDisplay}</p>
          </div>
        </section>

        {/* CONTACT */}
        {/* HOURS: a dedicated, easy-to-find section right above Contact (Abraham 14:45 CST; preview only) */}
        {/* HOURS: Abraham's simple list, one line per day. No holidays on the website (the phone system handles them). */}
        {/* Abraham: left column (heading + 24/7 box) centered against the hours card; the box is white with a thin navy border (no second yellow block under the yellow Call Now band) */}
        <section id="hours" data-hours className="scroll-mt-20 bg-hu-tint py-14 sm:py-20">
          <div data-hours-grid className="mx-auto grid max-w-6xl gap-8 px-4 sm:px-6 md:grid-cols-2 md:items-center md:gap-10">
            <div>
              <SectionTitle kicker="When to reach us" title="Our Hours" />
              <a href={`tel:${c.phoneE164}`} data-hours-note className="mt-6 flex items-center gap-3 rounded-2xl border border-hu-deep bg-white p-4 text-lg font-bold text-hu-deep hover:underline">
                <PhoneCall className="h-6 w-6 shrink-0" strokeWidth={ICON_STROKE} aria-hidden />
                <span>{WEBSITE_HOURS_NOTE}</span>
              </a>
            </div>
            <ul data-hours-list className="divide-y-2 divide-hu-deep/10 rounded-2xl border-2 border-hu-deep/10 bg-white px-5 text-lg">
              {websiteHoursLines(settings).map((line) => {
                const i = line.indexOf(": ");
                return (
                  <li key={line} className="py-3">
                    <span className="block text-sm font-bold uppercase tracking-wider opacity-70">{line.slice(0, i)}</span>
                    <span className="block whitespace-pre-line font-semibold">{keepTimesTogether(line.slice(i + 2))}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        <section id="contact" className="scroll-mt-20 bg-white py-14 sm:py-20">
          <div className="mx-auto grid max-w-6xl gap-8 px-4 sm:px-6 md:grid-cols-2 md:items-start md:gap-10">
            {/* Abraham: same as the other section headings (like the Our Hours heading): left-aligned, top of the column */}
            <SectionTitle kicker="Get in touch" title="Contact Us" />
            <ul data-contact-list className="divide-y-2 divide-hu-deep/10 border-y-2 border-hu-deep/10 text-lg">
              <li className="flex items-center gap-4 py-4">
                <IconTile icon={Store} tone="sky" />
                <div>
                  <p className="text-sm font-bold uppercase tracking-wider opacity-70">Business</p>
                  <div className="font-semibold">{BUSINESS_NAME_NB}</div>
                </div>
              </li>
              <li className="flex items-center gap-4 py-4">
                <IconTile icon={Phone} tone="sky" />
                <div>
                  <p className="text-sm font-bold uppercase tracking-wider opacity-70">Phone</p>
                  <div>
                    <a href={`tel:${c.phoneE164}`} className="font-semibold underline underline-offset-4">
                      {c.phoneDisplay}
                    </a>
                  </div>
                </div>
              </li>
              <li className="flex items-center gap-4 py-4">
                <IconTile icon={Mail} tone="sky" />
                <div className="min-w-0">
                  <p className="text-sm font-bold uppercase tracking-wider opacity-70">Email</p>
                  <div className="break-all">
                    <a href={`mailto:${c.email}`} className="font-semibold underline underline-offset-4">
                      {c.email}
                    </a>
                  </div>
                </div>
              </li>
              <li className="flex items-center gap-4 py-4">
                <IconTile icon={MapPin} tone="sky" />
                <div>
                  <p className="text-sm font-bold uppercase tracking-wider opacity-70">Service area</p>
                  <a
                    href={SERVICE_AREA_MAP_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${c.serviceArea.main}, plus nearby ${c.serviceArea.region} towns: open in Google Maps (opens in a new tab)`}
                    data-service-area-map
                    className="block font-semibold hover:underline focus-visible:underline"
                  >
                    {c.serviceArea.main}
                    <span className="block text-base font-medium underline underline-offset-4">Plus nearby {c.serviceArea.region} towns</span>
                  </a>
                </div>
              </li>
              {c.hours && (
                <li className="flex items-center gap-4 py-4">
                  <IconTile icon={CalendarCheck} tone="sky" />
                  <div>
                    <p className="text-sm font-bold uppercase tracking-wider opacity-70">Hours</p>
                    <div className="whitespace-pre-line font-semibold">{c.hours}</div>
                  </div>
                </li>
              )}
            </ul>
          </div>
        </section>
      </main>

      <SiteFooter c={c} />
    </div>
  );
}
