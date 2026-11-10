import { formatPhone } from "@/lib/phone";
import { getSettings } from "@/lib/settings";
import NotActive from "@/components/NotActive";
import { config } from "@/lib/config";
import { requireOwner } from "@/lib/auth";
import { SalesTaxForm } from "./PricingForms";

function Row({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="flex items-start gap-3 border-b border-line py-3 last:border-0">
      <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-sm font-black ${ok ? "bg-mint/20 text-[#13895C]" : "bg-sun/30 text-[#A87800]"}`}>{ok ? "✓" : "!"}</span>
      <div><div className="font-bold">{label}</div><div className="text-sm text-muted">{detail}</div></div>
    </div>
  );
}

export default async function SettingsPage() {
  await requireOwner();
  const base = config.baseUrl();
  const settings = await getSettings();
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-2xl font-black sm:text-3xl">General settings</h1>
      <p className="mb-5 text-muted">What&rsquo;s connected and working. The full list of what&rsquo;s waiting on an outside step is on <a className="underline" href="/admin/status">System status</a>.</p>
      <NotActive k="sms" />
      <NotActive k="payments" />
      <NotActive k="email" />
      <NotActive k="recording" />
      <div className="card mb-5 p-5">
        <Row ok={Boolean(process.env.DATABASE_URL)} label="Database" detail="Bookings, customers and settings are saved." />
        <Row ok={config.twilioConfigured()} label="Phone line and texts" detail={config.twilioConfigured() ? `Hotline number ${formatPhone(process.env.TWILIO_PHONE_NUMBER)}` : "Not connected yet."} />
        <Row ok={config.resendConfigured()} label="Email" detail={config.resendConfigured() ? "Sign-in codes and receipts can go out by email." : "Not connected yet."} />
        <Row ok={config.solaConfigured()} label="Card payments (Sola)" detail={config.solaConfigured() ? "Payment links work." : "Not connected yet."} />
        <Row ok={Boolean(process.env.SOLA_WEBHOOK_PIN)} label="Payment updates from Sola" detail={process.env.SOLA_WEBHOOK_PIN ? "Paid orders update by themselves." : "Not connected yet."} />
        <Row ok={Boolean(config.adminPhone())} label="Staff sign-in" detail={`Each staff member signs in with their own phone. The Owner's codes go to the number ending ${config.adminPhone().slice(-4) || "(not set)"}.`} />
      </div>
      <details className="card mb-5 p-5 text-sm" data-developer-notes>
        <summary className="cursor-pointer font-bold">Developer notes (for setup only)</summary>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-muted">
          <li>These are set in Vercel: Project, Settings, Environment Variables.</li>
          <li>Phone and texts: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER.</li>
          <li>Email: RESEND_API_KEY.</li>
          <li>Payments: SOLA_PAYMENTSITE_NAME{config.solaConfigured() ? ` (now ${process.env.SOLA_PAYMENTSITE_NAME})` : ""}; payment updates go to {base}/api/sola/webhook with SOLA_WEBHOOK_PIN.</li>
        </ul>
      </details>
      <section className="card mb-6 p-5" id="tax">
        <h2 className="mb-3 text-lg font-extrabold">Sales tax</h2>
        <SalesTaxForm initial={settings.salesTaxPercent} />
      </section>
      <p className="text-sm text-muted">
        Other settings now live with their topic: <a className="underline" href="/admin/phone/settings">Phone settings</a>, <a className="underline" href="/admin/delivery-settings">Delivery settings</a> and{" "}
        <a className="underline" href="/admin/holidays">Business hours &amp; holidays</a>.
      </p>
    </div>
  );
}
