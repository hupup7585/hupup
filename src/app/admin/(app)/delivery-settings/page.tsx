import { getSettings } from "@/lib/settings";
import { requireOwner } from "@/lib/auth";
import StockAddressForm from "../settings/StockAddressForm";
import { DeliveryPricingForm } from "../settings/PricingForms";
import { DELIVERY_TEMPLATES } from "@/lib/delivery-templates";

/** Deliveries → Delivery settings: delivery area, fees, stock address and the approved delivery texts. Owner only. */
export default async function DeliverySettingsPage() {
  await requireOwner();
  const settings = await getSettings();
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-2xl font-black sm:text-3xl">Delivery settings</h1>
      <p className="mb-5 text-muted">Delivery area and fees, where the day&rsquo;s run starts, and the texts drivers can send.</p>
      <section className="card mb-6 p-5" id="fees">
        <h2 className="mb-3 text-lg font-extrabold">Delivery area and fees</h2>
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
