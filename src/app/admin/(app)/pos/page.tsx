import { bookingLock } from "@/lib/jewish-calendar";
import { getSettings } from "@/lib/settings";
import { asc, eq } from "drizzle-orm";
import { webConsentCopy } from "@/lib/sms-terms-v2";
import { smsNumberDisplay } from "@/lib/sms-number";
import { db, schema } from "@/lib/db";
import { isValidISO, todayISO } from "@/lib/dates";
import { termsActive } from "@/lib/rental-terms";
import PosForm from "./PosForm";

export default async function PosPage({ searchParams }: { searchParams: Promise<{ date?: string; product?: string }> }) {
  const sp = await searchParams;
  const [cats, prods] = await Promise.all([
    db.select().from(schema.categories).orderBy(asc(schema.categories.sortOrder), asc(schema.categories.id)),
    db.select().from(schema.products).where(eq(schema.products.active, true)).orderBy(asc(schema.products.sortOrder), asc(schema.products.id)),
  ]);
  const lock = bookingLock(new Date(), await getSettings());
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
        consent={{ transactionalText: webConsentCopy().transactional, marketingText: webConsentCopy().marketing, smsNumber: smsNumberDisplay() }}
      />
    </div>
  );
}
