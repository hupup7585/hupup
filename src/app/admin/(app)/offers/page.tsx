import { trustedMsg } from "@/lib/url-message";
import { requireOwner } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { saveHolidayRentalsAction, saveOffersAction, saveOffersIntroAction } from "./actions";

/** Offers (Owner only): its own page in the side menu, under Catalog (Abraham, Nov 17, 2026). */
export default async function OffersPage({ searchParams }: { searchParams: Promise<{ ok?: string; oks?: string }> }) {
  await requireOwner();
  const sp = await searchParams;
  const settings = await getSettings();
  return (
    <div className="w-full">
      <h1 className="text-2xl font-black sm:text-3xl">Offers</h1>
      <p className="mb-5 mt-1 text-muted" data-offers-intro>{String(settings.offersIntro || "").trim() || "Turn each offer on or off here. Customers only get the offers that are on."}</p>
      {trustedMsg(sp.ok, sp.oks) && <p className="mb-4 rounded-xl bg-mint/15 p-3 font-semibold text-[#13895C]">{trustedMsg(sp.ok, sp.oks)}</p>}
      <section className="card mb-5 p-5" data-offers>
        <form action={saveOffersAction} className="grid gap-2">
          <label className="flex items-start gap-2"><input type="checkbox" name="laserThirdSetHalfOn" defaultChecked={settings.laserThirdSetHalfOn !== false} className="mt-1" /> <span><b>Laser tag: every third set half price.</b> On: every 3rd full set (maze with guns) is half price, and every 3rd extra gun set is half price, counted apart. It adds together with the other offers (Abraham, Nov 26, 2026): the half price is in the set price, and an offer such as Thursday to Sunday is worked out on top. Off: no third-set discount, and the phone does not offer the third gun set at half price.</span></label>
          <label className="flex items-start gap-2"><input type="checkbox" name="offerThuSunOn" defaultChecked={Boolean(settings.offerThuSunOn)} className="mt-1" /> <span><b>Thursday to Sunday: 1.5 times the rental.</b> One booking, delivered Thursday, picked up Monday (New booking shows the choice on a Thursday).</span></label>
          <label className="flex items-start gap-2"><input type="checkbox" name="offerFourthSundayOn" defaultChecked={Boolean(settings.offerFourthSundayOn)} className="mt-1" /> <span><b>4th Sunday free.</b> After 3 Sundays in a row, the 4th Sunday&rsquo;s rental is free (the cheapest item). Delivery: $20 Kiryas Joel, $30 nearby towns, $40 anywhere else. Thursday to Sunday bookings don&rsquo;t count as Sundays.</span></label>
          <button className="btn-dark mt-1 w-fit">Save offers</button>
        </form>
      </section>
      {/* The intro line above, editable (Abraham, Nov 26, 2026) */}
      <details className="mb-5" data-offers-intro-edit>
        <summary className="cursor-pointer text-sm font-semibold text-navy">Edit the line at the top of this page</summary>
        <form action={saveOffersIntroAction} className="mt-2 grid gap-2">
          <textarea name="offersIntro" rows={2} maxLength={500} defaultValue={String(settings.offersIntro)} className="input" />
          <button className="btn-dark w-fit">Save the line</button>
        </form>
      </details>
      {/* Chanukah and Chol Hamoed rentals (Abraham, Nov 18, 2026, approved) */}
      <section className="card mb-5 p-5" data-holiday-rentals>
        <h2 className="text-xl font-black">Chanukah and Chol Hamoed rentals</h2>
        <p className="mb-3 mt-1 text-sm text-muted">One price per booking day, picked up the next morning. A Friday rental is one full day, picked up after Shabbes. We are closed on Shabbes all year. Mutze Shabbes bookings start once their phone lines are approved.</p>
        <form action={saveHolidayRentalsAction} className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-start gap-2"><input type="checkbox" name="holidayPerDayChanukah" defaultChecked={settings.holidayPerDayChanukah !== false} className="mt-1" /> <span><b>Per-day pricing during Chanukah</b></span></label>
          <label className="flex items-start gap-2"><input type="checkbox" name="holidayPerDayCholHamoed" defaultChecked={settings.holidayPerDayCholHamoed !== false} className="mt-1" /> <span><b>Per-day pricing during Chol Hamoed</b></span></label>
          <label className="flex items-start gap-2 sm:col-span-2"><input type="checkbox" name="holidayNoPromos" defaultChecked={settings.holidayNoPromos !== false} className="mt-1" /> <span><b>No promos, discounts or offers</b> during Chanukah and Chol Hamoed</span></label>
          <label className="block"><span className="label">Friday pickup: minutes after Shabbes ends</span><input name="holidayPickupAfterShabbesMin" type="number" min={0} max={300} defaultValue={String(settings.holidayPickupAfterShabbesMin)} className="input" /></label>
          <label className="block"><span className="label">Mutze Shabbes delivery: minutes after Shabbes ends</span><input name="holidayMutzeDeliveryAfterMin" type="number" min={0} max={360} defaultValue={String(settings.holidayMutzeDeliveryAfterMin)} className="input" /></label>
          <label className="block"><span className="label">Sunday pickup time (after Mutze Shabbes)</span><input name="holidaySundayPickup" type="time" defaultValue={String(settings.holidaySundayPickup)} className="input" /></label>
          <label className="block"><span className="label">Friday plus Mutze Shabbes, days charged</span><input name="holidayFridayMutzeDays" type="number" step="0.5" min={1} max={3} defaultValue={String(settings.holidayFridayMutzeDays)} className="input" /></label>
          <label className="block"><span className="label">Mutze Shabbes alone, days charged</span><input name="holidayMutzeAloneDays" type="number" step="0.5" min={0.5} max={3} defaultValue={String(settings.holidayMutzeAloneDays)} className="input" /></label>
          <div className="sm:col-span-2"><button className="btn-dark w-fit">Save</button></div>
        </form>
      </section>
    </div>
  );
}
