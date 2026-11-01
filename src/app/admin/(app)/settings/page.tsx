import { config } from "@/lib/config";
import { maskedDestination } from "@/lib/auth";

function Row({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="flex items-start gap-3 border-b border-line py-3 last:border-0">
      <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-sm font-black ${ok ? "bg-mint/20 text-[#13895C]" : "bg-sun/30 text-[#A87800]"}`}>{ok ? "✓" : "!"}</span>
      <div><div className="font-bold">{label}</div><div className="text-sm text-muted">{detail}</div></div>
    </div>
  );
}

export default function SettingsPage() {
  const base = config.baseUrl();
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-2xl font-black sm:text-3xl">Settings & system status</h1>
      <p className="mb-5 text-muted">These are set as environment variables in Vercel (Project → Settings → Environment Variables).</p>
      <div className="card mb-5 p-5">
        <Row ok={Boolean(process.env.DATABASE_URL)} label="Database" detail="Postgres connection (Neon)." />
        <Row ok={config.twilioConfigured()} label="Twilio phone & SMS" detail={config.twilioConfigured() ? `Hotline number ${process.env.TWILIO_PHONE_NUMBER}` : "Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER."} />
        <Row ok={config.resendConfigured()} label="Email (Resend)" detail={config.resendConfigured() ? "Email sign-in codes and receipts enabled." : "Add RESEND_API_KEY to enable email codes."} />
        <Row ok={config.solaConfigured()} label="Sola Payments" detail={config.solaConfigured() ? `PaymentSITE: ${process.env.SOLA_PAYMENTSITE_NAME}` : "Add SOLA_PAYMENTSITE_NAME to send real payment links."} />
        <Row ok={Boolean(process.env.SOLA_WEBHOOK_PIN)} label="Sola payment webhook" detail={`Webhook URL: ${base}/api/sola/webhook (set SOLA_WEBHOOK_PIN to match the portal).`} />
        <Row ok={Boolean(config.adminPhone() && config.adminEmail())} label="Admin sign-in" detail={`Codes go to ${maskedDestination("sms")} and ${maskedDestination("email")}.`} />
      </div>
      <div className="card p-5">
        <h2 className="mb-2 font-bold">Twilio phone number setup</h2>
        <ol className="list-decimal space-y-1.5 pl-5 text-sm">
          <li>Voice → “A call comes in”: <b>Webhook</b>, <code className="rounded bg-bg px-1">{base}/api/voice/incoming</code>, HTTP POST</li>
          <li>Voice → “Call status changes”: <code className="rounded bg-bg px-1">{base}/api/voice/status</code> (releases cart holds when callers hang up)</li>
          <li>Hotline voice: <b>{config.voice()}</b> (change with IVR_VOICE)</li>
          <li>“Press 0” forwards to: <b>{config.forwardPhone() || "not set"}</b></li>
        </ol>
      </div>
    </div>
  );
}
