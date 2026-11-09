import { rangeHeading } from "@/lib/week-heading";

/** The Yiddish/Hebrew part: its own right-to-left span, smaller and lighter gray than the English. */
function Yi({
  children,
  paren = false,
}: {
  children: string;
  paren?: boolean;
}) {
  return (
    <span
      dir="rtl"
      lang="yi"
      data-yi
      className="whitespace-nowrap text-[0.85em] font-normal text-[#6B7A90]"
    >
      {paren ? `(${children})` : children}
    </span>
  );
}

/**
 * Staff date-range / week heading (Abraham):
 *   Availability
 *   Week of Parshas Toldos  (פרשת תולדות)
 *   From: Sunday, November 8, 2026  ·  זונטאג, כ״ח חשון
 *   To: Shabbos, November 14, 2026  ·  שבת קודש, ד׳ כסלו
 */
export default function DateRangeHeading({
  title,
  from,
  to,
  parsha = true,
  as: Tag = "h1",
  className = "",
}: {
  title?: string;
  from: string;
  to: string;
  parsha?: boolean;
  as?: "h1" | "h2";
  className?: string;
}) {
  const h = rangeHeading(from, to);
  return (
    <div data-range-heading className={className}>
      {title && <Tag className="text-2xl font-black sm:text-3xl">{title}</Tag>}
      {parsha && (
        <p data-week-line className="mt-1 text-base font-bold text-navy">
          <span>{h.week.en}</span>
          <span className="mx-2" aria-hidden />
          <Yi paren>{h.week.he}</Yi>
        </p>
      )}
      {(
        [
          ["From", h.from],
          ["To", h.to],
        ] as const
      ).map(([label, d]) => (
        <p
          key={label}
          data-range-line={label.toLowerCase()}
          className="text-sm text-navy"
        >
          <span className="font-semibold">{label}:</span> <span>{d.en}</span>
          <span className="mx-2 text-muted" aria-hidden>
            ·
          </span>
          <Yi>{d.he}</Yi>
        </p>
      ))}
    </div>
  );
}
