import { bookingLock } from "@/lib/jewish-calendar";
import { calendarNow } from "@/lib/clock";
import { getSettings } from "@/lib/settings";
import { asc, eq } from "drizzle-orm";
import { webConsentCopy } from "@/lib/sms-terms-v2";
import { smsNumberDisplay } from "@/lib/sms-number";
import { db, schema } from "@/lib/db";
import { isValidISO, todayISO } from "@/lib/dates";
import { termsActive } from "@/lib/rental-terms";
import PosForm from "./PosForm";

/** Month calendar date picker (Abraham, Nov 17, 2026): preview only until he approves the screenshot. */
const MONTH_CALENDAR_LIVE_APPROVED = true; // approved by Abraham, Nov 17, 2026

export default async function PosPage({ searchParams }: { searchParams: Promise<{ date?: string; product?: string }> }) {
  const sp = await searchParams;
  const [cats, prods] = await Promise.all([
    db.select().from(schema.categories).orderBy(asc(schema.categories.sortOrder), asc(schema.categories.id)),
    db.select().from(schema.products).where(eq(schema.products.active, true)).orderBy(asc(schema.products.sortOrder), asc(schema.products.id)),
  ]);
  const settings = await getSettings();
  const lock = bookingLock(calendarNow(), settings);
  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="mb-5 text-2xl font-black sm:text-3xl">New booking</h1>
      {lock.locked && (
        <p className="card mb-5 border-2 border-[#C83A2F] p-4 font-semibold text-[#5C1A14]" data-booking-locked>
          Booking is closed on {lock.reason}. It opens again {lock.opensAt ? `at ${lock.opensAt.toLocaleString("en-US", { weekday: "long", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })}` : `after ${lock.reason}`}. This happens by itself; nothing to switch.
        </p>
      )}
      <PosForm
        today={todayISO()}
        initialDate={sp.date && isValidISO(sp.date) ? sp.date : ""}
        initialProduct={sp.product ? Number(sp.product) : null}
        categories={cats.map((c) => ({ id: c.id, name: c.name }))}
        products={prods.map((p) => ({ id: p.id, categoryId: p.categoryId, name: p.name, priceCents: p.priceCents, quantity: p.quantity }))}
        askTerms={termsActive()}
        offerThuSun={Boolean(settings.offerThuSunOn)}
        monthCalendar={MONTH_CALENDAR_LIVE_APPROVED || process.env.VERCEL_ENV !== "production"}
        consent={{ transactionalText: webConsentCopy().transactional, marketingText: webConsentCopy().marketing, smsNumber: smsNumberDisplay() }}
      />
    </div>
  );
}
