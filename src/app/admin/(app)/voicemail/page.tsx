import { Download, Phone } from "lucide-react";
import { requireStaff } from "@/lib/auth";
import { formatPhone } from "@/lib/phone";
import { TEXT_ALERTS_NOT_ACTIVE, listVoicemails, mainBox, textingActive } from "@/lib/voicemail";
import { getSettings } from "@/lib/settings";
import { deleteVoicemailAction, saveBoxAction, setHeardAction, setUrgentAction } from "./actions";
import { dualDateTime } from "@/lib/dual-date";

export const dynamic = "force-dynamic";

const TZ = process.env.BUSINESS_TIMEZONE || "America/New_York";
const when = (d: Date) => dualDateTime(d);
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** Hotline voicemail: play, download, mark heard, urgent, call back, delete. Owner also edits the box settings. */
export default async function VoicemailPage() {
  const alertSettings = await getSettings();
  const staff = await requireStaff(["owner", "secretary"]);
  let box, list;
  try {
    box = await mainBox();
    list = await listVoicemails(box.id);
  } catch (e) {
    console.error("[voicemail page]", e);
    return (
      <div className="mx-auto max-w-4xl">
        <h1 className="mb-3 text-2xl font-black sm:text-3xl">Voicemail</h1>
        <p className="card p-6 text-muted">Voicemail isn&rsquo;t available yet. It turns on once the database update for voicemail is applied (with the next approved release).</p>
      </div>
    );
  }
  const unheard = list.filter((v) => !v.heardAt).length;
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-1 text-2xl font-black sm:text-3xl">Voicemail</h1>
      <p className="mb-5 text-muted">
        Messages left on the hotline (press 0 when the office is closed or no one answers). {unheard ? <b>{unheard} new.</b> : "No new messages."}
      </p>

      {!list.length && <p className="card p-6 text-muted">No messages yet.</p>}
      <ul className="space-y-3">
        {list.map((v) => (
          <li key={v.id} data-voicemail={v.id} className={`card p-4 ${v.heardAt ? "" : "border-l-4 border-l-sun"}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2 font-bold">
                {v.urgent && <span className="rounded-full bg-[#FFE6E4] px-2 py-0.5 text-xs font-black text-[#C83A2F]">URGENT</span>}
                {!v.heardAt && <span className="rounded-full bg-sun/50 px-2 py-0.5 text-xs font-black">NEW</span>}
                {v.fromNumber ? formatPhone(v.fromNumber) : "Withheld number"}
                <span className="font-normal text-muted">· {when(v.createdAt)} · {mmss(v.durationSec)}</span>
              </div>
              <div className="flex flex-wrap gap-2 text-sm">
                {v.fromNumber && (
                  <a className="btn-ghost inline-flex items-center gap-1" href={`tel:${v.fromNumber}`}>
                    <Phone className="h-4 w-4" aria-hidden /> Call back
                  </a>
                )}
                <a className="btn-ghost inline-flex items-center gap-1" href={`/api/admin/voicemail/${v.id}/audio?download=1`}>
                  <Download className="h-4 w-4" aria-hidden /> Download
                </a>
              </div>
            </div>
            <audio controls preload="none" className="mt-3 w-full" src={`/api/admin/voicemail/${v.id}/audio`} />
            <p className="mt-2 whitespace-pre-line text-[15px]">
              {v.transcription || <span className="text-muted">{v.transcriptionStatus === "pending" ? "Transcription on its way..." : "No transcription."}</span>}
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-sm">
              <form action={setHeardAction.bind(null, v.id, !v.heardAt)}>
                <button className="btn-ghost">{v.heardAt ? "Mark as new" : "Mark as heard"}</button>
              </form>
              <form action={setUrgentAction.bind(null, v.id, !v.urgent)}>
                <button className="btn-ghost">{v.urgent ? "Not urgent" : "Mark urgent"}</button>
              </form>
              <form action={deleteVoicemailAction.bind(null, v.id)}>
                <button className="btn-ghost text-[#C83A2F]">Delete</button>
              </form>
            </div>
          </li>
        ))}
      </ul>

      {staff.role === "owner" && (
        <form action={saveBoxAction} className="card mt-8 grid gap-4 p-5">
          <h2 className="text-lg font-black">Voicemail settings</h2>
          <input type="hidden" name="id" value={box.id} />
          <label className="flex items-center gap-2 font-semibold">
            <input type="checkbox" name="enabled" defaultChecked={box.enabled} /> Voicemail on (callers can leave a message)
          </label>
          <label className="block">
            <span className="label">Greeting before the beep (leave empty to use the standard one from Hotline prompts)</span>
            <textarea name="greetingText" defaultValue={box.greetingText ?? ""} rows={3} className="input" placeholder="Please leave your name, phone number, and a short message after the beep." />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex items-center gap-2 font-semibold">
              <input type="checkbox" name="transcribe" defaultChecked={box.transcribe} /> Transcribe messages to text (costs extra on Twilio; please ask before turning it on)
            </label>
            <label className="block">
              <span className="label">Longest message (seconds)</span>
              <input name="maxLengthSec" type="number" min={10} max={600} defaultValue={box.maxLengthSec} className="input" />
            </label>
          </div>
          <label className="block">
            <span className="label">Text a new-message alert to (one number per line)</span>
            {!textingActive() && (
              <span data-not-active="voicemail-text" className="mb-1 block rounded-lg bg-[#FFF8E1] px-3 py-2 text-sm text-[#5C4600]">
                <b>{TEXT_ALERTS_NOT_ACTIVE}.</b> Until then every voicemail goes by email with the recording attached. Text alerts start by themselves once texting is approved.
              </span>
            )}
            <textarea name="notifySms" defaultValue={box.notifySms.map((p) => formatPhone(p)).join("\n")} rows={2} className="input" />
          </label>
          <label className="block">
            <span className="label">Email a new-message alert to (one email per line)</span>
            <textarea name="notifyEmail" defaultValue={box.notifyEmail.join("\n")} rows={2} className="input" />
          </label>
          <fieldset className="grid gap-2" data-owner-alerts>
            <legend className="label">Other alerts to the same addresses</legend>
            <label className="flex items-start gap-2 font-semibold">
              <input type="checkbox" name="missedCallAlerts" defaultChecked={Boolean(alertSettings.missedCallAlerts)} className="mt-1" />
              <span>
                Missed calls
                <span className="block text-sm font-normal text-muted">The caller reached voicemail and hung up without a message, or hung up while the phone was ringing. One alert per call.</span>
              </span>
            </label>
            <label className="flex items-start gap-2 font-semibold">
              <input type="checkbox" name="incomingTextEmail" defaultChecked={Boolean(alertSettings.incomingTextEmail)} className="mt-1" />
              <span>
                Email a copy of every text to (845) 415-7585
                <span className="block text-sm font-normal text-muted">The sender&rsquo;s number and the full text, with a link to any photo.</span>
              </span>
            </label>
          </fieldset>
          <label className="flex items-start gap-2 font-semibold" data-voicemail-mms>
            <input type="checkbox" name="voicemailMms" defaultChecked={Boolean(alertSettings.voicemailMms)} className="mt-1" />
            <span>
              Attach the recording (MP3) to the text alert
              <span className="block text-sm font-normal text-muted">A text with a recording is a picture/audio message (MMS), which costs more per message than a plain text. Sends once Twilio texting is approved. Long recordings go as a link only.</span>
            </span>
          </label>
          <button className="btn-dark w-fit">Save voicemail settings</button>
        </form>
      )}
    </div>
  );
}
