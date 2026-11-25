import { getSettings } from "@/lib/settings";
import { requireOwner } from "@/lib/auth";
import StockAddressForm from "../settings/StockAddressForm";
import { DeliveryPricingForm } from "../settings/PricingForms";
import { DELIVERY_TEMPLATES } from "@/lib/delivery-templates";
import { PROMO_CENTS, deliveryPromoActive, priceFor, savedAreas, zoneFee } from "@/lib/delivery-areas";
import { checkAddressAction, reloadMapAction, saveAreasAction, saveLocalStreetsAction, saveZonePricesAction } from "./area-actions";

const usd = (c: number | string) => `$${(Number(c) / 100).toFixed(2)}`;

/** Deliveries → Delivery settings: delivery area, fees, stock address and the approved delivery texts. Owner only. */
export default async function DeliverySettingsPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  await requireOwner();
  const settings = await getSettings();
  const m = (await searchParams).m;
  const areas = savedAreas(settings.deliveryAreas);
  return (
    <div className="w-full">
      <h1 className="mb-1 text-2xl font-black sm:text-3xl">Delivery settings</h1>
      <p className="mb-5 text-muted">Delivery area and fees, where the day&rsquo;s run starts, and the texts drivers can send.</p>
      {m && <p className="mb-4 rounded-lg bg-[#E7F1FB] p-3 text-sm font-semibold text-navy" data-areas-message>{m}</p>}
      <section className="card mb-6 p-5" id="areas" data-delivery-areas>
        <h2 className="mb-1 text-lg font-extrabold">Delivery prices by map area</h2>
        <p className="mb-3 text-sm text-muted">
          The delivery price is decided by the house, not the street: the zone on your Google map (&ldquo;Price list&rdquo;) that the house sits in. Inside the KJ line {usd(zoneFee("local", settings))}, inside any other colored area {usd(zoneFee("area", settings))}, anywhere else in Orange County {usd(zoneFee("outside", settings))}; on a zone line, the lower price. The phone line, New booking and the payment total all use it, and nobody can change the price on an order by hand. To change a shape, edit it on the Google map, then press Reload the map; your names and prices here are kept.
        </p>
        <form action={saveZonePricesAction} className="mb-4 grid gap-3 rounded-xl border border-line p-4" data-zone-prices>
          <h3 className="font-bold">Zone prices</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block"><span className="label">Kiryas Joel ($)</span><input name="kj" defaultValue={(Number(settings.deliveryFeeKjCents) / 100).toFixed(2)} inputMode="decimal" className="input" /></label>
            <label className="block"><span className="label">Nearby towns ($)</span><input name="area" defaultValue={(Number(settings.deliveryFeeAreaCents) / 100).toFixed(2)} inputMode="decimal" className="input" /></label>
            <label className="block"><span className="label">Anywhere else in Orange County ($)</span><input name="outside" defaultValue={(Number(settings.deliveryFeeOutsideCents) / 100).toFixed(2)} inputMode="decimal" className="input" /></label>
          </div>
          <h3 className="mt-2 font-bold">Free delivery promo</h3>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="promoOn" defaultChecked={Boolean(settings.deliveryPromoOn)} /> On: Kiryas Joel delivery free, nearby towns {usd(PROMO_CENTS.area)}. Anywhere else in Orange County stays {usd(zoneFee("outside", { ...settings, deliveryPromoOn: false }))}.</label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block"><span className="label">Starts (blank = right away)</span><input type="date" name="promoStart" defaultValue={settings.deliveryPromoStart} className="input" /></label>
            <label className="block"><span className="label">Ends (blank = until you turn it off)</span><input type="date" name="promoEnd" defaultValue={settings.deliveryPromoEnd} className="input" /></label>
          </div>
          <p className="text-sm font-semibold" data-promo-status>{deliveryPromoActive(settings) ? "The promo is on today." : settings.deliveryPromoOn ? "The promo is switched on, but today is outside its dates." : "The promo is off: regular prices."}</p>
          <button className="btn-dark w-fit">Save prices</button>
        </form>
        {areas.length === 0 ? (
          <p className="mb-3 text-sm">The map is not loaded yet, so the town lists below are used. Press Reload the map.</p>
        ) : (
          <form action={saveAreasAction} className="mb-3 grid gap-2">
            {areas.map((a) => (
              <div key={a.id} className="grid grid-cols-[1fr_7rem] items-end gap-2">
                <label className="block"><span className="label">Area name {a.mapName !== a.name && <span className="text-xs text-muted">(on the map: {a.mapName})</span>}</span><input name={`name:${a.id}`} defaultValue={a.name} className="input" /></label>
                <div><span className="label">Price</span><div className="py-2 font-bold">{usd(priceFor(a, settings))}</div></div>
              </div>
            ))}
            <div className="flex items-center justify-between gap-2 rounded-lg bg-[#F5F7FA] p-2 text-sm"><span>Anywhere else in Orange County (outside every colored area)</span><b>{usd(zoneFee("outside", settings))}</b></div>
            <span className="text-xs text-muted">Prices today, from Zone prices above. A house on a zone line gets the lower price. The map&rsquo;s own price labels are not used.</span>
            <button className="btn-dark w-fit">Save names</button>
          </form>
        )}
        <div className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
          <form action={reloadMapAction}><button className="btn-ghost">Reload the map</button></form>
          <form action={checkAddressAction} className="flex flex-1 flex-wrap items-end gap-2">
            <label className="block min-w-48 flex-1"><span className="label">Check an address</span><input name="address" className="input" placeholder="12 Forest Road, Monroe, NY 10950" /></label>
            <button className="btn-ghost">Check</button>
          </form>
        </div>
        {settings.deliveryAreasLoadedAt && <p className="mt-2 text-xs text-muted">Map last loaded {new Date(settings.deliveryAreasLoadedAt).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" })}.</p>}
      </section>
      <section className="card mb-6 p-5" id="streets" data-local-streets>
        <h2 className="mb-1 text-lg font-extrabold">Kiryas Joel street list</h2>
        <p className="mb-3 text-sm text-muted">One street per line. When a caller or staff member types a street that is close to one of these, the order page suggests the right spelling. It does not change any price.</p>
        <form action={saveLocalStreetsAction} className="grid gap-2">
          <textarea name="streets" rows={8} defaultValue={String(settings.localStreets ?? "")} className="input font-mono text-sm" />
          <button className="btn-dark w-fit">Save streets</button>
        </form>
      </section>
      <section className="card mb-6 p-5" id="fees">
        <h2 className="mb-3 text-lg font-extrabold">Town lists (used only until the map is loaded)</h2>
        <DeliveryPricingForm initial={{ deliveryFeeKjCents: settings.deliveryFeeKjCents, deliveryFeeAreaCents: settings.deliveryFeeAreaCents, zoneKjPlaces: settings.zoneKjPlaces, zoneAreaPlaces: settings.zoneAreaPlaces }} />
      </section>
      <section className="card mb-6 p-5" id="stock">
        <h2 className="mb-3 text-lg font-extrabold">Delivery routes: stock address</h2>
        <StockAddressForm initial={settings.stockAddress} />
      </section>

      <section className="card mb-6 p-5" id="templates">
        <h2 className="mb-1 text-lg font-extrabold">Delivery texts (templates)</h2>
        <p className="mb-3 text-sm text-muted">Your approved wording. Drivers pick one of these; they can&rsquo;t type their own. Ask Claude to change the wording.</p>
        <ul className="grid gap-3">
          {Object.entries(DELIVERY_TEMPLATES).map(([k, t]) => (
            <li key={k} className="rounded-lg border border-line p-3">
              <div className="font-bold">{t.label}</div>
              <div className="text-sm text-muted">{t.body}</div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
