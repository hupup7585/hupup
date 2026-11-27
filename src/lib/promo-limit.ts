import { getSettings } from "@/lib/settings";
import { PROMOS_PER_YEAR } from "@/lib/sms-consent-copy";

/** The yearly limit in force (server only): the Admin setting "promosPerYear" (5 to start). The words customers see say 5. */
export async function promosPerYear(): Promise<number> {
  const n = Math.round(Number((await getSettings()).promosPerYear));
  return Number.isFinite(n) && n >= 1 && n <= 12 ? n : PROMOS_PER_YEAR;
}
