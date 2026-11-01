import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { BUSINESS_NAME, config } from "@/lib/config";

export const revalidate = 300;

type Cat = { id: number; name: string; description: string; emoji: string; imageUrl: string | null };

const FALLBACK: Cat[] = [
  { id: 1, name: "Bounce Houses", emoji: "🏰", imageUrl: null, description: "Castles, combos and slides — cleaned, safe, and set up by our crew." },
  { id: 2, name: "Laser Tag & Inflatable Mazes", emoji: "🎯", imageUrl: null, description: "Full laser tag kits with giant inflatable arenas — perfect for groups." },
  { id: 3, name: "Paddle Boats", emoji: "🚣", imageUrl: null, description: "Pool-ready paddle boats for summer splash days." },
];

const TINTS = ["bg-[#FFE1DD]", "bg-[#DDF0FF]", "bg-[#FFF0C9]", "bg-[#E3F8EF]", "bg-[#EEE6FF]"];

async function loadCategories(): Promise<Cat[]> {
  try {
    const rows = await db
      .select()
      .from(schema.categories)
      .where(eq(schema.categories.active, true))
      .orderBy(asc(schema.categories.sortOrder), asc(schema.categories.id));
    return rows.length ? rows : FALLBACK;
  } catch {
    return FALLBACK;
  }
}

function Phone({ className = "" }: { className?: string }) {
  return (
    <a href={`tel:${config.hotlineE164}`} className={className}>
      📞 Call to book
    </a>
  );
}

export default async function Landing() {
  const cats = await loadCategories();
  const year = new Date().getFullYear();
  return (
    <main className="overflow-x-hidden">
      {/* Nav */}
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-8">
        <a href="/" className="flex items-center gap-3 text-lg font-black sm:text-2xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt={`${BUSINESS_NAME} logo`} className="h-11 w-auto" />
          <span>{BUSINESS_NAME}</span>
        </a>
        <div className="hidden gap-8 font-semibold text-muted md:flex">
          <a href="#rentals" className="hover:text-navy">Rentals</a>
          <a href="#how" className="hover:text-navy">How it works</a>
          <a href="#area" className="hover:text-navy">Service area</a>
        </div>
        <Phone className="btn hidden sm:inline-flex" />
      </nav>

      {/* Hero */}
      <section className="bg-gradient-to-b from-white to-[#FFF6E5]">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-8 sm:px-8 lg:grid-cols-[1.25fr_1fr]">
          <div>
            <span className="inline-block rounded-full bg-[#E8F5FF] px-4 py-2 text-sm font-bold text-sky">
              📍 Proudly serving Kiryas Joel &amp; the surrounding area
            </span>
            <h1 className="mt-5 text-4xl font-black leading-[1.03] sm:text-6xl">
              Bounce, battle &amp; <span className="text-coral">splash</span> — delivered to your door.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted sm:text-xl">
              Bounce houses, laser tag with inflatable mazes, and paddle boats for simchas, school events and backyard
              fun. We deliver on your day and pick up the next.
            </p>
            <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center">
              <a href={`tel:${config.hotlineE164}`} className="btn whitespace-nowrap px-7 py-4 text-lg">
                📞 Call our booking line
              </a>
              <div>
                <a href={`tel:${config.hotlineE164}`} className="whitespace-nowrap text-3xl font-black sm:text-4xl">
                  {config.hotlineDisplay}
                </a>
                <div className="text-muted">Book by phone, 24/7 — fully automated</div>
              </div>
            </div>
          </div>
          <div className="relative mx-auto hidden h-[420px] w-full max-w-[520px] lg:block" aria-hidden>
            <div className="absolute left-4 top-2 grid h-60 w-64 place-items-center rounded-[40px] bg-[#FFE1DD] text-8xl shadow-xl shadow-navy/10">🏰</div>
            <div className="absolute right-0 top-14 grid h-48 w-52 place-items-center rounded-[40px] bg-[#DDF0FF] text-8xl shadow-xl shadow-navy/10">🎯</div>
            <div className="absolute bottom-0 left-32 grid h-48 w-72 place-items-center rounded-[40px] bg-[#FFF0C9] text-8xl shadow-xl shadow-navy/10">🚣</div>
          </div>
        </div>
      </section>

      {/* Categories */}
      <section id="rentals" className="mx-auto max-w-6xl px-4 py-16 sm:px-8">
        <h2 className="mb-8 text-3xl font-black">Our rentals</h2>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {cats.map((c, i) => (
            <div key={c.id} className="card p-6">
              <div className={`mb-5 grid h-44 place-items-center overflow-hidden rounded-2xl text-7xl ${TINTS[i % TINTS.length]}`}>
                {c.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.imageUrl} alt={c.name} className="h-full w-full object-cover" />
                ) : (
                  c.emoji
                )}
              </div>
              <h3 className="text-2xl font-bold">{c.name}</h3>
              <p className="mt-2 leading-relaxed text-muted">{c.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="bg-navy text-white">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 sm:px-8 md:grid-cols-3">
          {[
            ["Call the hotline", "Pick a category with your keypad, hear the details, and add items to your cart."],
            ["Choose your date", "Live availability — if it's free, it's held for you while you finish your call."],
            ["We deliver & pick up", "Set up on your day, picked up the next. Pay securely by text link."],
          ].map(([t, d], i) => (
            <div key={t}>
              <div className="mb-3 grid h-11 w-11 place-items-center rounded-full bg-sun text-xl font-black text-navy">{i + 1}</div>
              <h3 className="text-xl font-bold">{t}</h3>
              <p className="mt-1 text-white/75">{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Service area + CTA */}
      <section id="area" className="mx-auto max-w-6xl px-4 py-16 text-center sm:px-8">
        <h2 className="text-3xl font-black">Serving Kiryas Joel &amp; nearby</h2>
        <p className="mx-auto mt-3 max-w-2xl text-lg text-muted">
          We deliver throughout Kiryas Joel, Monroe, Harriman, Chester, Blooming Grove and the surrounding Orange County
          area. Not sure if we reach you? Just call.
        </p>
        <Phone className="btn mt-8 px-8 py-4 text-lg" />
      </section>

      <footer className="mx-auto flex max-w-6xl flex-col gap-2 border-t border-line px-4 py-6 text-sm text-muted sm:flex-row sm:justify-between sm:px-8">
        <span>© {year} {BUSINESS_NAME} · hupupattractions.com</span>
        <span>Kiryas Joel, NY · {config.hotlineDisplay}</span>
      </footer>
    </main>
  );
}
