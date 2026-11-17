import { requireOwner } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { saveOffersAction } from "./actions";

/** Offers (Owner only): its own page in the side menu, under Catalog (Abraham, Nov 17, 2026). */
export default async function OffersPage({ searchParams }: { searchParams: Promise<{ ok?: string }> }) {
  await requireOwner();
  const sp = await searchParams;
  const settings = await getSettings();
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-black sm:text-3xl">Offers</h1>
      <p className="mb-5 mt-1 text-muted">Each offer is off until you switch it on. They never combine: a booking gets the one that saves the customer the most. They cover jumping balloons, laser tag and paddle boats.</p>
      {sp.ok && <p className="mb-4 rounded-xl bg-mint/15 p-3 font-semibold text-[#13895C]">{sp.ok}</p>}
      <section className="card mb-5 p-5" data-offers>
        <form action={saveOffersAction} className="grid gap-2">
          <label className="flex items-start gap-2"><input type="checkbox" name="offerLaserThirdPackOn" defaultChecked={Boolean(settings.offerLaserThirdPackOn)} className="mt-1" /> <span><b>Laser tag: third pack 50% off.</b> Every gun pack counts, the guns with a maze included. Only the 3rd pack.</span></label>
          <label className="flex items-start gap-2"><input type="checkbox" name="offerThuSunOn" defaultChecked={Boolean(settings.offerThuSunOn)} className="mt-1" /> <span><b>Thursday to Sunday: 1.5 times the rental.</b> One booking, delivered Thursday, picked up Monday (New booking shows the choice on a Thursday).</span></label>
          <label className="flex items-start gap-2"><input type="checkbox" name="offerFourthSundayOn" defaultChecked={Boolean(settings.offerFourthSundayOn)} className="mt-1" /> <span><b>4th Sunday free.</b> After 3 Sundays in a row, the 4th Sunday&rsquo;s rental is free (the cheapest item). Delivery: $20 Kiryas Joel, $30 nearby towns, $40 anywhere else. Thursday to Sunday bookings don&rsquo;t count as Sundays.</span></label>
          <button className="btn-dark mt-1 w-fit">Save offers</button>
        </form>
      </section>
    </div>
  );
}
