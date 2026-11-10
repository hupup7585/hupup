import { getSettings } from "@/lib/settings";
import NotActive from "@/components/NotActive";
import { config } from "@/lib/config";
import { requireOwner } from "@/lib/auth";
import RoutingForm from "../../settings/RoutingForm";
import BlockingForm from "../../settings/BlockingForm";
import RecordingForm from "../../settings/RecordingForm";
import { PROMPTS } from "@/lib/ivr/prompts";
import { RING_KEYS, RING_KEY_LABELS, isLoopNumber, last4, ringListFor, routeSummary, routeTargets } from "@/lib/ivr/routing";
import { toE164 } from "@/lib/phone";

/** Phone System → Phone settings: ring lists (extensions, call routing, ring times), recording, caller blocking, Twilio setup. Owner only. */
export default async function PhoneSettingsPage() {
  await requireOwner();
  const base = config.baseUrl();
  const settings = await getSettings();
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-2xl font-black sm:text-3xl">Phone settings</h1>
      <p className="mb-5 text-muted">Who rings for each main-menu key, how long each phone rings, call recording and caller blocking.</p>
      {(() => {
        const fwd = toE164(config.forwardPhone());
        return fwd && isLoopNumber(fwd) && !routeTargets(settings).length ? (
          <div data-ring-warning className="mb-5 rounded-xl border border-[#E8B4AE] bg-[#FDF1EF] p-4 text-sm text-[#7A2318]">
            <b>No one to ring yet.</b> The old default rang &ldquo;Office&rdquo; at {last4(fwd)}, but that number forwards back to the hotline, so calls looped and went to
            voicemail within seconds. It is no longer rung. Add a staff member&rsquo;s own mobile number to the Key 0 (Operator) list below; the other keys use it
            until they get their own list.
          </div>
        ) : null;
      })()}
      <NotActive k="sms" />
      <NotActive k="recording" />
      <section className="card mb-6 p-5" id="routing">
        <h2 className="mb-1 text-lg font-extrabold">Live employee ring lists (main menu keys 2, 4, 5, 6, 8 and 0)</h2>
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
      <section className="card mb-6 p-5" id="recording">
        <h2 className="mb-3 text-lg font-extrabold">Call recording</h2>
        <RecordingForm on={settings.callRecording} notice={PROMPTS.recording_notice.text} />
      </section>

      <section className="card mb-6 p-5" id="blocking">
        <h2 className="mb-3 text-lg font-extrabold">Caller blocking</h2>
        <BlockingForm initial={settings.blockedCallers} />
      </section>
      <details className="card p-5" data-developer-notes>
        <summary className="cursor-pointer font-bold">Developer notes: Twilio phone number setup</summary>
        <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm">
          <li>Voice → “A call comes in”: <b>Webhook</b>, <code className="rounded bg-bg px-1">{base}/api/voice/incoming</code>, HTTP POST</li>
          <li>Voice → “Call status changes”: <code className="rounded bg-bg px-1">{base}/api/voice/status</code> (releases cart holds when callers hang up)</li>
          <li>Hotline voice: <b>{config.voice()}</b> (change with IVR_VOICE)</li>
          <li>“Press 0” rings: <b>{routeSummary(routeTargets(settings), settings.operatorMode)}</b> (edit above)</li>
        </ol>
      </details>
    </div>
  );
}
