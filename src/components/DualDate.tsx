import { dualDateTimeParts, dualParts, type DualParts } from "@/lib/dual-date";

/**
 * A date in both calendars, side by side: "Sunday, Nov 8, 2026 / כ״ח חשון תשפ״ז".
 * The Hebrew part is isolated right-to-left so it never scrambles the English around it.
 * Pass `iso` for a calendar day or `at` for a moment (the Hebrew date turns over at nightfall).
 */
export default function DualDate({ iso, at, style = "long", stack = false, className = "" }: { iso?: string; at?: Date | string; style?: "long" | "short"; stack?: boolean; className?: string }) {
  const p: DualParts = at !== undefined ? dualDateTimeParts(at) : dualParts(iso!, style);
  return (
    <span data-dual-date className={className}>
      <span>{p.en}</span>
      {stack ? <br /> : <span aria-hidden> / </span>}
      <bdi dir="rtl" lang="yi" className="whitespace-nowrap">
        {p.he}
      </bdi>
    </span>
  );
}

/** Just the Hebrew day and month, for small spots like calendar column headers: "כ״ח חשון". */
export function HebrewDay({ iso, className = "" }: { iso: string; className?: string }) {
  return (
    <bdi dir="rtl" lang="yi" data-hebrew-day className={className}>
      {dualParts(iso, "short").he}
    </bdi>
  );
}
