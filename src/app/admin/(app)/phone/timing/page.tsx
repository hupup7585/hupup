import { VM_LOCK_MINUTES, VM_PIN_TRIES } from "@/lib/vm-access";
import { PIECE_SECONDS } from "@/lib/vm-audio";
import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { PHONE_TIMERS, timerValues } from "@/lib/ivr/timers";

export const metadata = { title: "Phone timing | Hup Up Attractions" };
export const dynamic = "force-dynamic";

/**
 * Phone timing (Admin handoff Phase 3, section 9A, Nov 26, 2026), Owner only: every wait on the phone line, its value
 * now, its starting value and a plain-English explanation. Changes go through All settings (draft, publish, history,
 * undo), so nothing reaches callers until it is published.
 */
export default async function PhoneTimingPage() {
  await requireOwner();
  const now = timerValues((await getSettings()) as Record<string, unknown>);
  return (
    <div className="w-full" data-phone-timing>
      <h1 className="text-2xl font-black sm:text-3xl">Phone timing</h1>
      <p className="mb-4 mt-1 text-muted">
        Every wait the phone line uses, in seconds unless it says otherwise. The starting values are exactly what the phone used before this page existed. To change one,
        choose Change: it opens in All settings as a draft, and callers hear the new timing only after you publish it.
      </p>
      <div className="grid gap-3">
        {PHONE_TIMERS.map((t) => (
          <div key={t.key} className="card p-4" data-timer={t.key}>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-bold">{t.label}</span>
              <span className="rounded-full bg-mint/20 px-2 text-xs font-bold text-[#13895C]">Now: {now[t.key]}</span>
              {now[t.key] !== t.default && <span className="rounded-full bg-[#FFF8E1] px-2 text-xs font-bold text-[#5C4600]">Changed from {t.default}</span>}
            </div>
            <dl className="mt-1 grid gap-0.5 text-sm">
              <div><dt className="inline font-semibold">What it does: </dt><dd className="inline text-muted">{t.what}</dd></div>
              <div><dt className="inline font-semibold">Where the caller meets it: </dt><dd className="inline text-muted">{t.where}</dd></div>
              <div><dt className="inline font-semibold">If you change it: </dt><dd className="inline text-muted">{t.ifChanged} Allowed from {t.min} to {t.max}.</dd></div>
            </dl>
            <Link className="mt-1 inline-block text-sm font-semibold text-navy underline" href={{ pathname: "/admin/config", query: { q: t.key } }}>Change</Link>
          </div>
        ))}
      </div>
      <section className="card mt-5 p-4" data-timers-locked>
        <h2 className="font-bold">Fixed for safety (not changed here)</h2>
        <ul className="mt-1 list-disc pl-5 text-sm text-muted">
          <li>Voicemail password by phone: {VM_PIN_TRIES} wrong tries, then the box locks for {VM_LOCK_MINUTES} minutes. This stops someone guessing a password; a lower number would lock out real staff, a higher one would make guessing easier.</li>
          <li>Voicemail playback is sent in pieces of {PIECE_SECONDS} seconds, so long messages start playing quickly. This is a technical setting of the phone service, not a wait the caller notices.</li>
        </ul>
      </section>
      <section className="card mt-5 p-4" data-timers-not-built>
        <h2 className="font-bold">Not built yet (Needs Claude to connect)</h2>
        <ul className="mt-1 list-disc pl-5 text-sm text-muted">
          <li>What happens after the main menu plays its last time with no key (hang up, the operator, voicemail or a line).</li>
          <li>A different no-key wait for one screen only.</li>
          <li>How many wrong keys in a row, and what happens then.</li>
          <li>Speech: the quiet that ends an answer for each question, speech or keypad per question, and a keypad fallback.</li>
          <li>The quiet that ends a message, set for each voicemail box.</li>
          <li>Pause lengths between lines, and a pause line on Phone screens.</li>
        </ul>
      </section>
    </div>
  );
}
