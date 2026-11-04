import type { Metadata } from "next";
import { CalendarCheck, ClipboardCheck, Headset, ListChecks, Mail, MapPin, PartyPopper, Phone, PhoneCall, Search, Store, Truck } from "lucide-react";
import { getSiteContent } from "@/lib/site-content";
import { BUSINESS_NAME_NB, keepName, noLonelyWord, whyLabel, DELIVERY_FEE_NOTE, DELIVERY_FEE_SHORT, SERVICE_AREA_DELIVERY_NOTE, FINAL_CTA_TEXT, FINAL_CTA_TITLE, INTRO, SLOGAN, STEPS, WHY, serviceAreaPlaces } from "@/lib/site-copy";
import { theme } from "@/lib/theme";
import SiteHeader from "@/components/site/SiteHeader";
import SiteFooter from "@/components/site/SiteFooter";
import { CallButton, ICON_STROKE, IconTile, SectionTitle, Wave, categoryIcon } from "@/components/site/parts";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Hup Up Attractions | Jumping Balloon, Laser Tag and Paddle Boat Rentals",
  description:
    "Hup Up Attractions offers Jumping Balloons (bounce houses), laser tag, inflatable maze, and paddle boat rentals for parties and events in Kiryas Joel (Town of Palm Tree), Monroe, Chester, and nearby Orange County, NY towns. Delivery available for an additional fee. Call (845) 777-7585 to book.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Hup Up Attractions | Party and Event Rentals",
    description: "Jumping balloons, laser tag, inflatable mazes, and paddle boats for parties, schools, celebrations, and special occasions. Call to book.",
    type: "website",
    siteName: "Hup Up Attractions",
  },
};

/**
 * Even chip grid: each chip spans 2 tracks (4 tracks = 2 columns on phones, 8 tracks = 4 columns from md/768px).
 * The leftover last row is centered by starting its first chip later.
 */
function townCentering(i: number, count: number): string {
  const classes: string[] = [];
  if (count % 2 === 1 && i === count - 1) classes.push("col-start-2");
  const r4 = count % 4;
  const firstOfLastRow = count - r4;
  if (r4 > 0 && i === firstOfLastRow) {
    classes.push(r4 === 3 ? "md:col-start-2" : r4 === 2 ? "md:col-start-3" : "md:col-start-4");
  } else if (count % 2 === 1 && i === count - 1) {
    classes.push("md:col-start-auto");
  }
  return classes.join(" ");
}

const WHY_ICONS = [PartyPopper, ListChecks, PhoneCall, Headset, Truck, ClipboardCheck];
const STEP_ICONS = [Search, PhoneCall, CalendarCheck];

export default async function Home() {
  const c = await getSiteContent();
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: "Hup Up Attractions",
    description: "Jumping Balloon (bounce house), laser tag, inflatable maze, and paddle boat rentals for parties and events.",
    telephone: c.phoneE164,
    email: c.email,
    url: process.env.PUBLIC_BASE_URL || "https://hupup.vercel.app",
    ...(c.logoUrl ? { logo: c.logoUrl } : {}),
    areaServed: [
      { "@type": "Place", name: `${c.serviceArea.main}, NY`, alternateName: `${c.serviceArea.officialName}, NY` },
      ...serviceAreaPlaces()
        .slice(1)
        .map((name) => ({ "@type": "Place", name: `${name}, NY` })),
      { "@type": "AdministrativeArea", name: c.serviceArea.region.replace(", NY", ", New York") },
    ],
    ...(c.hours ? { openingHours: c.hours } : {}),
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
              <p className="mt-5 max-w-xl text-lg font-medium leading-relaxed sm:text-xl">{keepName(INTRO)}</p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <CallButton phone={c.phoneE164} label="CALL NOW TO BOOK" className="!min-h-14 !px-5 text-lg min-[360px]:!px-8" />
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
                    <li key={cat.id} className="last:pr-[6.75rem] sm:last:pr-[7.75rem]">
                      <a href={`#${cat.slug}`} className="flex items-center gap-4 py-3.5 text-lg font-bold hover:underline">
                        <IconTile icon={categoryIcon(cat.name)} tone="sky" />
                        {cat.name}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
              {/* Sticker sits on the board's bottom-right corner, clear of the phone number at every width */}
              <span
                data-sticker="delivery-option"
                className="absolute -bottom-12 right-2 flex h-[6.5rem] w-[6.5rem] rotate-12 items-center justify-center rounded-full border-2 border-hu-deep bg-hu-yellow text-center text-[10px] font-extrabold uppercase leading-[1.15] sm:-bottom-14 sm:right-3 sm:h-[7.5rem] sm:w-[7.5rem] sm:text-[11.5px]"
                aria-label="Option for delivery"
              >
                <span data-badge-group className="flex flex-col items-center gap-0.5 text-hu-deep">
                  <Truck className="h-5 w-5 sm:h-6 sm:w-6" strokeWidth={ICON_STROKE} aria-hidden />
                  <span>Option</span>
                  <span>for delivery</span>
                </span>
              </span>
            </div>
          </div>
          <Wave fill={theme.white} />
        </section>

        {/* OUR RENTALS: full-width numbered rows (not a card grid) */}
        <section id="rentals" className="scroll-mt-20 bg-white py-14 sm:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionTitle kicker="What we rent" title="Our Rentals" />
            <div className="mt-10 border-t-[3px] border-hu-deep">
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
              {/* Secondary line under the heading: 60% of the heading size at every width (Abram 10:52 PM); icon scales with the text */}
              <a
                data-why-phone
                href={`tel:${c.phoneE164}`}
                className="mt-8 inline-flex items-center gap-[0.4em] text-[1.02rem] font-bold underline decoration-hu-yellow decoration-[3px] underline-offset-[5px] min-[370px]:text-[1.125rem] sm:text-[1.35rem] xl:text-[1.8rem]"
              >
                <Phone className="h-[0.9em] w-[0.9em] shrink-0" strokeWidth={ICON_STROKE} aria-hidden />
                {c.phoneDisplay}
              </a>
            </div>
            <ul className="grid auto-rows-fr gap-x-10 sm:grid-cols-2">
              {WHY.map((w, i) => (
                <li key={w} className="flex w-full items-center gap-4 border-b-2 border-hu-deep/10 py-4 text-lg font-semibold">
                  <IconTile icon={WHY_ICONS[i]} tone="white" />
                  <span className="min-w-0 flex-1 [text-wrap:balance]">{whyLabel(w)}</span>
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
            <div className="mt-10 flex justify-center">
              <p data-delivery-note className="inline-flex items-center gap-3 rounded-2xl bg-hu-tint px-4 py-3 text-center text-base font-semibold">
                <Truck className="h-5 w-5 shrink-0" strokeWidth={ICON_STROKE} aria-hidden />
                <span className="[text-wrap:balance]">{DELIVERY_FEE_NOTE}</span>
              </p>
            </div>
          </div>
        </section>

        {/* SERVICE AREA: main area first and prominent, nearby towns clearly secondary */}
        <section id="service-area" className="scroll-mt-20 bg-hu-sky py-14 sm:py-16">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="flex items-center gap-4">
              <IconTile icon={MapPin} tone="white" size="lg" />
              <h2 className="text-3xl font-extrabold sm:text-4xl lg:text-5xl">Service Area</h2>
            </div>
            <div className="mt-8 grid gap-6">
              <div className="rounded-[2rem] border-[3px] border-hu-deep bg-white p-6 shadow-[6px_6px_0_#123D73] sm:p-8">
                <p className="text-base font-extrabold uppercase tracking-[0.14em] text-hu-deep/75">{c.serviceArea.mainLabel}</p>
                <p className="mt-2 text-4xl font-extrabold leading-tight sm:text-5xl">{c.serviceArea.main}</p>
                <p className="mt-2 text-base font-medium text-hu-deep/80">{c.serviceArea.mainSub}</p>
                {/* Calm note: regular weight, slightly smaller, 16px+ clear above and below, icon aligned to the first line */}
                <p data-sa-delivery-note className="mt-4 flex items-start gap-2 text-[15px] font-normal leading-6 text-hu-deep">
                  <Truck className="mt-[3px] h-[18px] w-[18px] shrink-0 overflow-visible" strokeWidth={ICON_STROKE} aria-hidden />
                  <span className="[text-wrap:balance]">{noLonelyWord(SERVICE_AREA_DELIVERY_NOTE)}</span>
                </p>
                <CallButton phone={c.phoneE164} className="mt-5" />
              </div>
              <div className="rounded-3xl bg-hu-tint p-4 min-[360px]:p-5 sm:p-7">
                <h3 className="text-lg font-bold">{c.serviceArea.alsoTitle}</h3>
                <ul className="mt-4 grid auto-rows-fr grid-cols-4 gap-2 md:grid-cols-8">
                  {c.serviceArea.also.map((town, i, all) => (
                    <li
                      key={town}
                      className={`col-span-2 flex items-center justify-center rounded-2xl border-2 border-hu-deep/20 bg-white px-1.5 py-2.5 text-center text-[13px] font-semibold leading-snug min-[360px]:text-[15px] md:px-3 md:py-3 md:text-base ${townCentering(i, all.length)}`}
                    >
                      {town.includes(" and ") ? (
                        <span>
                          {town.split(" and ")[0]} and
                          <span className="block"> {town.split(" and ")[1]}</span>
                        </span>
                      ) : (
                        town
                      )}
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-base">All in {c.serviceArea.region}. {DELIVERY_FEE_SHORT}</p>
              </div>
            </div>
          </div>
        </section>

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
        <section id="contact" className="scroll-mt-20 bg-white py-14 sm:py-20">
          <div className="mx-auto grid max-w-6xl gap-8 px-4 sm:px-6 md:grid-cols-2 md:items-center md:gap-10">
            <SectionTitle kicker="Get in touch" title="Contact Us" />
            <dl className="divide-y-2 divide-hu-deep/10 border-y-2 border-hu-deep/10 text-lg">
              <div className="flex items-center gap-4 py-4">
                <IconTile icon={Store} tone="sky" />
                <div>
                  <dt className="text-sm font-bold uppercase tracking-wider opacity-70">Business</dt>
                  <dd className="font-semibold">{BUSINESS_NAME_NB}</dd>
                </div>
              </div>
              <div className="flex items-center gap-4 py-4">
                <IconTile icon={Phone} tone="yellow" />
                <div>
                  <dt className="text-sm font-bold uppercase tracking-wider opacity-70">Phone</dt>
                  <dd>
                    <a href={`tel:${c.phoneE164}`} className="font-semibold underline underline-offset-4">
                      {c.phoneDisplay}
                    </a>
                  </dd>
                </div>
              </div>
              <div className="flex items-center gap-4 py-4">
                <IconTile icon={Mail} tone="sky" />
                <div className="min-w-0">
                  <dt className="text-sm font-bold uppercase tracking-wider opacity-70">Email</dt>
                  <dd className="break-all">
                    <a href={`mailto:${c.email}`} className="font-semibold underline underline-offset-4">
                      {c.email}
                    </a>
                  </dd>
                </div>
              </div>
              <div className="flex items-center gap-4 py-4">
                <IconTile icon={MapPin} tone="sky" />
                <div>
                  <dt className="text-sm font-bold uppercase tracking-wider opacity-70">Service area</dt>
                  <dd className="font-semibold">
                    {c.serviceArea.main}
                    <a href="#service-area" className="block text-base font-medium underline underline-offset-4">
                      Plus nearby {c.serviceArea.region} towns
                    </a>
                  </dd>
                </div>
              </div>
              {c.hours && (
                <div className="flex items-center gap-4 py-4">
                  <IconTile icon={CalendarCheck} tone="sky" />
                  <div>
                    <dt className="text-sm font-bold uppercase tracking-wider opacity-70">Hours</dt>
                    <dd className="whitespace-pre-line font-semibold">{c.hours}</dd>
                  </div>
                </div>
              )}
            </dl>
          </div>
        </section>
      </main>

      <SiteFooter c={c} />
    </div>
  );
}
