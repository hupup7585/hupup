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
    </div>
  );
}
