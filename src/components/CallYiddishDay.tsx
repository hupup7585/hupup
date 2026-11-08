import { Moon, Sun } from "lucide-react";
import { yiddishCallDay } from "@/lib/yiddish-day";

/**
 * Call log (Abraham BB, BB3): the Yiddish day of a call. The day turns over at 6:00 AM New York time: before 6 AM is
 * the previous day's night (moon), 6 AM to noon is the morning (sun). Small line icons in muted navy; screens only.
 */
export default function CallYiddishDay({ at }: { at: Date | string }) {
  const d = yiddishCallDay(new Date(at));
  const Icon = d.part === "night" ? Moon : d.part === "morning" ? Sun : null;
  return (
    <span data-call-yiddish className="inline-flex items-center gap-1 text-[#123D73]">
      {Icon && <Icon aria-hidden className="h-[1em] w-[1em] shrink-0 opacity-80" strokeWidth={1.75} data-icon={d.part} />}
      <bdi dir="rtl" lang="yi" className="whitespace-nowrap">
        {d.label}, {d.parsha}
      </bdi>
    </span>
  );
}
