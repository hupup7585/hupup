import { getSettings } from "@/lib/settings";
import { requireOwner } from "@/lib/auth";
import StockAddressForm from "../settings/StockAddressForm";
import { DeliveryPricingForm } from "../settings/PricingForms";
import { DELIVERY_TEMPLATES } from "@/lib/delivery-templates";
import { savedAreas } from "@/lib/delivery-areas";
import { checkAddressAction, reloadMapAction, saveAreasAction } from "./area-actions";

/** Deliveries → Delivery settings: delivery area, fees, stock address and the approved delivery texts. Owner only. */
export default async function DeliverySettingsPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  await requireOwner();
  const settings = await getSettings();
  const m = (await searchParams).m;
  const areas = savedAreas(settings.deliveryAreas);
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-2xl font-black sm:text-3xl">Delivery settings</h1>
      <p className="mb-5 text-muted">Delivery area and fees, where the day&rsquo;s run starts, and the texts drivers can send.</p>
      {m && <p className="mb-4 rounded-lg bg-[#E7F1FB] p-3 text-sm font-semibold text-navy" data-areas-message>{m}</p>}
      <section className="card mb-6 p-5" id="areas" data-delivery-areas>
        <h2 className="mb-1 text-lg font-extrabold">Delivery prices by map area</h2>
        <p className="mb-3 text-sm text-muted">
          The delivery fee comes from the area on your Google map (&ldquo;Price list&rdquo;) that the delivery address falls in. The phone line, New booking and the payment total all use it. An address outside every area never gets a guessed price: staff get a task to quote it. To change a shape, edit it on the Google map, then press Reload the map; your names and prices here are kept.
        </p>
        {areas.length === 0 ? (
          <p className="mb-3 text-sm">The map is not loaded yet, so the town lists below are used. Press Reload the map.</p>
        ) : (
          <form action={saveAreasAction} className="mb-3 grid gap-2">
            {areas.map((a) => (
              <div key={a.id} className="grid grid-cols-[1fr_7rem] items-end gap-2">
                <label className="block"><span className="label">Area name {a.mapName !== a.name && <span className="text-xs text-muted">(on the map: {a.mapName})</span>}</span><input name={`name:${a.id}`} defaultValue={a.name} className="input" /></label>
                <label className="block"><span className="label">Price</span><input name={`price:${a.id}`} inputMode="decimal" defaultValue={a.priceCents === null ? "" : (a.priceCents / 100).toFixed(2)} placeholder="no price" className="input" /></label>
              </div>
            ))}
            <span className="text-xs text-muted">Leave a price empty if staff should quote that area. Where two areas overlap, the smaller one wins.</span>
            <button className="btn-dark w-fit">Save names and prices</button>
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
