import { dualDateTimeParts, dualParts, type DualParts } from "@/lib/dual-date";
import { yiddishDay, yiddishMoment } from "@/lib/yiddish-day";

/**
 * A date in both calendars, side by side: "Sunday, Nov 8, 2026 / כ״ח חשון תשפ״ז".
 * The Hebrew part is isolated right-to-left so it never scrambles the English around it.
 * Pass `iso` for a calendar day or `at` for a moment (the Hebrew date turns over at nightfall).
 */
export default function DualDate({ iso, at, style = "long", stack = false, yi = false, className = "" }: { iso?: string; at?: Date | string; style?: "long" | "short"; stack?: boolean; yi?: boolean; className?: string }) {
  const p: DualParts = at !== undefined ? dualDateTimeParts(at) : dualParts(iso!, style);
  return (
    <span data-dual-date className={className}>
      <span>{p.en}</span>
      {stack ? <br /> : <span aria-hidden> / </span>}
      <bdi dir="rtl" lang="yi" className="whitespace-nowrap">
        {p.he}
      </bdi>
      {yi && (
        <>
          {stack ? <br /> : <span aria-hidden> / </span>}
          <YiddishDay iso={iso} at={at} />
        </>
      )}
    </span>
  );
}

/**
 * Staff screens only (Abraham Y/Z/AA): the Yiddish day and the week's parsha, e.g. "זונטאג, פרשת חיי שרה".
 * A moment (`at`) after Shabbos ends shows "מוצאי שבת קודש" with next week's parsha; a plain day keeps "שבת קודש".
 */
export function YiddishDay({ iso, at, className = "" }: { iso?: string; at?: Date | string; className?: string }) {
  const text = at !== undefined ? yiddishMoment(new Date(at)) : yiddishDay(iso!);
  return (
    <bdi dir="rtl" lang="yi" data-yiddish-day className={`whitespace-nowrap ${className}`}>
      {text}
    </bdi>
  );
}

/** Just the Hebrew day and month, for small spots like calendar column headers: "כ״ח חשון". */
export function HebrewDay({ iso, yi = false, className = "" }: { iso: string; yi?: boolean; className?: string }) {
  return (
    <>
      <bdi dir="rtl" lang="yi" data-hebrew-day className={className}>
        {dualParts(iso, "short").he}
      </bdi>
      {yi && <YiddishDay iso={iso} className="block text-[0.85em] font-normal opacity-80" />}
    </>
  );
}
