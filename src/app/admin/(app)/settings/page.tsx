import { getSettings } from "@/lib/settings";
import CalendarSettingsForm from "./CalendarSettingsForm";
import { CALENDAR_KEYS } from "./calendar-keys";
import { config } from "@/lib/config";
import { requireOwner } from "@/lib/auth";
import RoutingForm from "./RoutingForm";
import BlockingForm from "./BlockingForm";
import { RING_KEYS, RING_KEY_LABELS, ringListFor, routeSummary, routeTargets } from "@/lib/ivr/routing";

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
  const calInitial = Object.fromEntries(CALENDAR_KEYS.map((k) => [k, String(settings[k])]));
  return (
    <div className="mx-auto max-w-3xl">
      <section className="card mb-6 p-5" id="calendar">
        <h2 className="mb-3 text-lg font-extrabold">Jewish calendar: open and closed days</h2>
        <CalendarSettingsForm initial={calInitial} />
      </section>
      <section className="card mb-6 p-5" id="routing">
        <h2 className="mb-1 text-lg font-extrabold">Live employee ring lists (main menu keys 2, 4, 5, 6 and 0)</h2>
        <p className="mb-4 text-sm text-muted">Key 9 goes straight to the general voicemail, no ringing.</p>
        <div className="grid gap-8">
          {RING_KEYS.map((k) => {
            const list = ringListFor(settings, k);
            const own = k === "0" ? { targets: settings.operatorTargets, mode: settings.operatorMode, accept: settings.operatorAcceptPrompt } : { targets: settings[`ringTargets${k}`], mode: settings[`ringMode${k}`], accept: settings[`ringAccept${k}`] };
            return (
              <div key={k}>
                <h3 className="mb-2 font-extrabold">{RING_KEY_LABELS[k]}</h3>
                <RoutingForm
                  ringKey={k}
                  initial={{ ...own, acceptText: settings.operatorAcceptText }}
                  summary={`${list.usesOperatorList ? "No numbers yet, so it uses the operator list: " : ""}${routeSummary(list.targets, list.mode)}`}
                />
              </div>
            );
          })}
        </div>
      </section>
      <section className="card mb-6 p-5" id="blocking">
        <h2 className="mb-3 text-lg font-extrabold">Caller blocking</h2>
        <BlockingForm initial={settings.blockedCallers} />
      </section>
      <h1 className="mb-1 text-2xl font-black sm:text-3xl">Settings & system status</h1>
      <p className="mb-5 text-muted">These are set as environment variables in Vercel (Project → Settings → Environment Variables).</p>
      <div className="card mb-5 p-5">
        <Row ok={Boolean(process.env.DATABASE_URL)} label="Database" detail="Postgres connection (Neon)." />
        <Row ok={config.twilioConfigured()} label="Twilio phone & SMS" detail={config.twilioConfigured() ? `Hotline number ${process.env.TWILIO_PHONE_NUMBER}` : "Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER."} />
        <Row ok={config.resendConfigured()} label="Email (Resend)" detail={config.resendConfigured() ? "Email sign-in codes and receipts enabled." : "Add RESEND_API_KEY to enable email codes."} />
        <Row ok={config.solaConfigured()} label="Sola Payments" detail={config.solaConfigured() ? `PaymentSITE: ${process.env.SOLA_PAYMENTSITE_NAME}` : "Add SOLA_PAYMENTSITE_NAME to send real payment links."} />
        <Row ok={Boolean(process.env.SOLA_WEBHOOK_PIN)} label="Sola payment webhook" detail={`Webhook URL: ${base}/api/sola/webhook (set SOLA_WEBHOOK_PIN to match the portal).`} />
        <Row ok={Boolean(config.adminPhone())} label="Staff sign-in" detail={`Each staff member signs in with their own phone. The owner's codes go to the number ending ${config.adminPhone().slice(-4) || "(not set)"}.`} />
      </div>
      <div className="card p-5">
        <h2 className="mb-2 font-bold">Twilio phone number setup</h2>
        <ol className="list-decimal space-y-1.5 pl-5 text-sm">
          <li>Voice → “A call comes in”: <b>Webhook</b>, <code className="rounded bg-bg px-1">{base}/api/voice/incoming</code>, HTTP POST</li>
          <li>Voice → “Call status changes”: <code className="rounded bg-bg px-1">{base}/api/voice/status</code> (releases cart holds when callers hang up)</li>
          <li>Hotline voice: <b>{config.voice()}</b> (change with IVR_VOICE)</li>
          <li>“Press 0” rings: <b>{routeSummary(routeTargets(settings), settings.operatorMode)}</b> (edit above)</li>
        </ol>
      </div>
    </div>
  );
}
