/**
 * Weekly parsha, diaspora schedule (Abraham Y/Z/AA), written in-house like the rest of this calendar and checked
 * against hebcal in the tests. Each week (Sunday through Shabbos) is named for the parsha read that Shabbos; when
 * that Shabbos is Yom Tov or Chol Hamoed, the week is named for the Yom Tov.
 *
 * How the readings fall: from Bereshis (first Shabbos after Simchas Torah) the parshiyos are read in order, one per
 * Shabbos that isn't Yom Tov, with a few pairs read together when there aren't enough Shabbosim. Fixed points:
 * Bamidbar is the last Shabbos before Shavuos, Devarim the Shabbos on or before Tisha B'Av, and Nitzavim the last
 * Shabbos before Rosh Hashanah (with Vayeilech when there's no room for it in Tishrei).
 */
import { AV, NISAN, SIVAN, TISHREI, fixedFromISO, fromFixed, isLeapYear, isoFromFixed, newYear, toFixed, weekday } from "./hebrew-date";

export const PARSHIYOS = [
  "בראשית", "נח", "לך לך", "וירא", "חיי שרה", "תולדות", "ויצא", "וישלח", "וישב", "מקץ", "ויגש", "ויחי",
  "שמות", "וארא", "בא", "בשלח", "יתרו", "משפטים", "תרומה", "תצוה", "כי תשא", "ויקהל", "פקודי",
  "ויקרא", "צו", "שמיני", "תזריע", "מצורע", "אחרי מות", "קדושים", "אמור", "בהר", "בחוקותי",
  "במדבר", "נשא", "בהעלותך", "שלח", "קרח", "חקת", "בלק", "פינחס", "מטות", "מסעי",
  "דברים", "ואתחנן", "עקב", "ראה", "שופטים", "כי תצא", "כי תבוא", "נצבים", "וילך", "האזינו",
] as const;

/** Pairs that can be read together, by the first parsha's index. */
const VAYAKHEL = 21, TAZRIA = 26, ACHAREI = 28, BEHAR = 31, CHUKAS = 38, MATOS = 41, NITZAVIM = 50;
const BAMIDBAR = 33, DEVARIM = 43, VAYEILECH = 51, HAAZINU = 52;
/** Which pairs are combined first when Shabbosim are short (segment Bereshis..Bamidbar, then Nasso..Devarim). */
const DOUBLE_ORDER_1 = [TAZRIA, ACHAREI, BEHAR, VAYAKHEL];
const DOUBLE_ORDER_2 = [MATOS, CHUKAS];

/** A Shabbos reading: parsha indexes (one, or two read together), or a Yom Tov name. */
export type Reading = { parsha: number[] } | { yomTov: string };

/** Yom Tov / Chol Hamoed on a Shabbos (diaspora), in Hebrew letters; null if it's an ordinary Shabbos. */
export function shabbosYomTov(month: number, day: number): string | null {
  if (month === TISHREI) {
    if (day === 1 || day === 2) return "ראש השנה";
    if (day === 10) return "יום כיפור";
    if (day === 15 || day === 16) return "סוכות";
    if (day >= 17 && day <= 21) return "חול המועד סוכות";
    if (day === 22) return "שמיני עצרת";
    if (day === 23) return "שמחת תורה";
  }
  if (month === NISAN) {
    if (day === 15 || day === 16 || day === 21 || day === 22) return "פסח";
    if (day >= 17 && day <= 20) return "חול המועד פסח";
  }
  if (month === SIVAN && (day === 6 || day === 7)) return "שבועות";
  return null;
}

const firstShabbosOnOrAfter = (rd: number) => rd + ((6 - weekday(rd) + 7) % 7);

const cache = new Map<number, Map<number, Reading>>();

/**
 * Every Shabbos of the reading cycle that starts on Bereshis in Hebrew year y, through the last Shabbos before
 * Rosh Hashanah y+1, plus the Tishrei Shabbosim of y+1 (Vayeilech / Haazinu).
 */
function cycle(y: number): Map<number, Reading> {
  const hit = cache.get(y);
  if (hit) return hit;
  const out = new Map<number, Reading>();
  const nextRh = newYear(y + 1);
  const shavuos = toFixed({ year: y, month: SIVAN, day: 6 });
  const tishaBav = toFixed({ year: y, month: AV, day: 9 });
  const bereshis = firstShabbosOnOrAfter(toFixed({ year: y, month: TISHREI, day: 24 }));
  // Shabbosim that get a parsha, from Bereshis to the last Shabbos before next Rosh Hashanah
  const slots: number[] = [];
  for (let d = bereshis; d < nextRh; d += 7) {
    const h = fromFixed(d);
    const yt = shabbosYomTov(h.month, h.day);
    if (yt) out.set(d, { yomTov: yt });
    else slots.push(d);
  }
  const bamidbarSlot = slots.filter((d) => d < shavuos).length - 1;
  const devarimSlot = slots.filter((d) => d <= tishaBav).length - 1;
  // Tishrei of the next year: Shabbosim between Rosh Hashanah and Sukkos that aren't Yom Tov
  const tishreiSlots: number[] = [];
  for (let d = firstShabbosOnOrAfter(nextRh); d < toFixed({ year: y + 1, month: TISHREI, day: 15 }); d += 7) {
    const h = fromFixed(d);
    if (!shabbosYomTov(h.month, h.day)) tishreiSlots.push(d);
  }
  const vayeilechInTishrei = tishreiSlots.length >= 2;

  /** Parshiyos first..last into slots from..to, combining pairs in `order` until they fit. Extra slots continue in order. Returns the next parsha. */
  const assign = (from: number, to: number, first: number, last: number, order: number[]) => {
    const count = to - from + 1;
    let needed = last - first + 1;
    const combined = new Set<number>();
    for (const p of order) {
      if (needed <= count) break;
      if (p >= first && p + 1 <= last) (combined.add(p), needed--);
    }
    let p = first;
    for (let i = from; i <= to; i++) {
      if (combined.has(p)) (out.set(slots[i], { parsha: [p, p + 1] }), (p += 2));
      else (out.set(slots[i], { parsha: [p] }), p++);
    }
    return p;
  };
  // Bamidbar is read by the Shabbos before Shavuos (Nasso too, when there's an extra Shabbos)
  const afterSeg1 = assign(0, bamidbarSlot, 0, BAMIDBAR, DOUBLE_ORDER_1);
  assign(bamidbarSlot + 1, devarimSlot, afterSeg1, DEVARIM, DOUBLE_ORDER_2);
  assign(devarimSlot + 1, slots.length - 1, DEVARIM + 1, vayeilechInTishrei ? NITZAVIM : VAYEILECH, vayeilechInTishrei ? [] : [NITZAVIM]);
  // Next Tishrei: Vayeilech (if it wasn't read with Nitzavim), then Haazinu
  const rest = vayeilechInTishrei ? [VAYEILECH, HAAZINU] : [HAAZINU];
  tishreiSlots.forEach((d, i) => rest[i] !== undefined && out.set(d, { parsha: [rest[i]] }));
  cache.set(y, out);
  return out;
}

/** The reading for the Shabbos on R.D. `rd` (must be a Shabbos). */
export function readingOn(rd: number): Reading {
  const h = fromFixed(rd);
  const yt = shabbosYomTov(h.month, h.day);
  if (yt) return { yomTov: yt };
  // Shabbosim before Bereshis belong to the previous year's cycle (Vayeilech / Haazinu)
  const bereshis = firstShabbosOnOrAfter(toFixed({ year: h.year, month: TISHREI, day: 24 }));
  const r = (rd >= bereshis ? cycle(h.year) : cycle(h.year - 1)).get(rd);
  return r ?? { yomTov: "" };
}

/** "פרשת חיי שרה", "פרשת ויקהל-פקודי", or the Yom Tov ("חול המועד פסח"). */
export function readingLabel(r: Reading): string {
  if ("yomTov" in r) return r.yomTov;
  return `פרשת ${r.parsha.map((p) => PARSHIYOS[p]).join("-")}`;
}

/** The Shabbos that ends the week of this date (the date itself if it's Shabbos). */
export const weekShabbos = (iso: string) => firstShabbosOnOrAfter(fixedFromISO(iso));

/** Parsha label for the week containing this civil date (Sunday-Shabbos). */
export function parshaForDate(iso: string): string {
  return readingLabel(readingOn(weekShabbos(iso)));
}

/** Used by tests: ISO of the Shabbos after a date. */
export const shabbosIso = (iso: string) => isoFromFixed(weekShabbos(iso));
export { isLeapYear };
