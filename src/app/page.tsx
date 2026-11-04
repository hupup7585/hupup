import type { Metadata } from "next";
import { CalendarCheck, ClipboardCheck, Headset, ListChecks, Mail, MapPin, PartyPopper, Phone, PhoneCall, Search, Truck } from "lucide-react";
import { getSiteContent } from "@/lib/site-content";
import { FINAL_CTA_TEXT, FINAL_CTA_TITLE, INTRO, SLOGAN, STEPS, WHY, serviceAreaPlaces } from "@/lib/site-copy";
import { theme } from "@/lib/theme";
import SiteHeader from "@/components/site/SiteHeader";
import SiteFooter from "@/components/site/SiteFooter";
import { CallButton, ICON_STROKE, IconTile, SectionTitle, Wave, categoryIcon } from "@/components/site/parts";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Hup Up Attractions | Bounce House, Laser Tag and Paddle Boat Rentals",
  description:
    "Hup Up Attractions offers bounce house, laser tag, inflatable maze, and paddle boat rentals for parties and events in Kiryas Joel / Town of Palm Tree, Monroe, Chester, and nearby Orange County, NY towns. Call (845) 777-7585 to book.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Hup Up Attractions | Party and Event Rentals",
    description: "Bounce houses, laser tag, inflatable mazes, and paddle boats for parties, schools, celebrations, and special occasions. Call to book.",
    type: "website",
    siteName: "Hup Up Attractions",
  },
};

const WHY_ICONS = [PartyPopper, ListChecks, PhoneCall, Headset, Truck, ClipboardCheck];
const STEP_ICONS = [Search, PhoneCall, CalendarCheck];

export default async function Home() {
  const c = await getSiteContent();
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: "Hup Up Attractions",
    description: "Bounce house, laser tag, inflatable maze, and paddle boat rentals for parties and events.",
    telephone: c.phoneE164,
    email: c.email,
    url: process.env.PUBLIC_BASE_URL || "https://hupup.vercel.app",
    ...(c.logoUrl ? { logo: c.logoUrl } : {}),
    areaServed: [
      ...serviceAreaPlaces().map((name) => ({ "@type": "Place", name: `${name}, NY` })),
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
              <p className="mt-5 max-w-xl text-lg font-medium leading-relaxed sm:text-xl">{INTRO}</p>
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
                <ul className="mt-6 divide-y-2 divide-hu-deep/10 border-t-2 border-hu-deep/10 pr-24 sm:pr-28">
                  {c.categories.map((cat) => (
                    <li key={cat.id}>
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
                data-sticker="we-deliver"
                className="absolute -bottom-8 right-3 grid h-20 w-20 rotate-12 place-items-center rounded-full border-2 border-hu-deep bg-hu-yellow text-center text-xs font-extrabold uppercase leading-tight sm:-bottom-10 sm:right-4 sm:h-24 sm:w-24 sm:text-sm"
              >
                <span className="flex flex-col items-center">
                  <Truck className="mb-0.5 h-5 w-5 sm:h-6 sm:w-6" strokeWidth={ICON_STROKE} aria-hidden />
                  <span>We</span>
                  <span>deliver</span>
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
          <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[1fr_1.3fr] lg:items-center">
            <div>
              <SectionTitle title="Why Choose Hup Up Attractions" />
              <a href={`tel:${c.phoneE164}`} className="mt-6 inline-flex items-center gap-2 text-2xl font-extrabold underline decoration-hu-yellow decoration-[6px] underline-offset-[6px]">
                {c.phoneDisplay}
              </a>
            </div>
            <ul className="grid gap-x-10 sm:grid-cols-2">
              {WHY.map((w, i) => (
                <li key={w} className="flex items-center gap-4 border-b-2 border-hu-deep/10 py-4 text-lg font-semibold">
                  <IconTile icon={WHY_ICONS[i]} tone="white" />
                  {w}
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
          </div>
        </section>

        {/* SERVICE AREA: main area first and prominent, nearby towns clearly secondary */}
        <section id="service-area" className="scroll-mt-20 bg-hu-sky py-14 sm:py-16">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="flex items-center gap-4">
              <IconTile icon={MapPin} tone="white" size="lg" />
              <h2 className="text-3xl font-extrabold sm:text-4xl lg:text-5xl">Service Area</h2>
            </div>
            <div className="mt-8 grid gap-6 lg:grid-cols-[1.15fr_1fr] lg:items-start">
              <div className="rounded-[2rem] border-[3px] border-hu-deep bg-white p-6 shadow-[6px_6px_0_#123D73] sm:p-8">
                <p className="text-base font-extrabold uppercase tracking-[0.14em] text-hu-deep/75">{c.serviceArea.mainLabel}</p>
                <p className="mt-2 text-[1.55rem] font-extrabold leading-tight min-[370px]:text-3xl sm:text-4xl">
                  {c.serviceArea.main.split(" / ").map((part, i) => (
                    <span key={part}>
                      {i > 0 && " / "}
                      <span className="whitespace-nowrap">{part}</span>
                    </span>
                  ))}
                </p>
                <p className="mt-3 text-lg font-medium">{c.serviceArea.region}</p>
                <CallButton phone={c.phoneE164} className="mt-6" />
              </div>
              <div className="rounded-3xl bg-hu-tint p-6 sm:p-7">
                <h3 className="text-lg font-bold">{c.serviceArea.alsoTitle}</h3>
                <ul className="mt-4 flex flex-wrap gap-2">
                  {c.serviceArea.also.map((town) => (
                    <li key={town} className="rounded-full border-2 border-hu-deep/20 bg-white px-3.5 py-1.5 text-base font-semibold">
                      {town}
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-base">All in {c.serviceArea.region}.</p>
              </div>
            </div>
          </div>
        </section>

        {/* FINAL CTA */}
        <section className="bg-hu-yellow">
          <div className="mx-auto max-w-4xl px-4 py-16 text-center sm:px-6 sm:py-20">
            <h2 className="text-3xl font-extrabold leading-tight sm:text-5xl">{FINAL_CTA_TITLE}</h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg font-medium sm:text-xl">{FINAL_CTA_TEXT}</p>
            <a href={`tel:${c.phoneE164}`} className="mt-8 inline-flex min-h-14 items-center gap-3 rounded-full bg-hu-deep px-9 py-4 text-lg font-bold tracking-wide text-white hover:bg-[#0d2f5a]">
              <Phone className="h-5 w-5" strokeWidth={ICON_STROKE} aria-hidden /> CALL NOW TO BOOK
            </a>
            <p className="mt-4 text-2xl font-extrabold">{c.phoneDisplay}</p>
          </div>
        </section>

        {/* CONTACT */}
        <section id="contact" className="scroll-mt-20 bg-white py-14 sm:py-20">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 md:grid-cols-2">
            <SectionTitle kicker="Get in touch" title="Contact Us" />
            <dl className="divide-y-2 divide-hu-deep/10 border-y-2 border-hu-deep/10 text-lg">
              <div className="flex items-center gap-4 py-4">
                <IconTile icon={PartyPopper} tone="sky" />
                <div>
                  <dt className="text-sm font-bold uppercase tracking-wider opacity-70">Business</dt>
                  <dd className="font-semibold">Hup Up Attractions</dd>
                </div>
              </div>
              <div className="flex items-center gap-4 py-4">
                <IconTile icon={Phone} tone="yellow" />
                <div>
                  <dt className="text-sm font-bold uppercase tracking-wider opacity-70">Phone</dt>
                  <dd>
                    <a href={`tel:${c.phoneE164}`} className="text-xl font-extrabold underline underline-offset-4">
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
