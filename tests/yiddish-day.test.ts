import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { HDate, getSedra } from "@hebcal/core";
import { readingOn } from "@/lib/hup-calendar/parsha";
import { fixedFromISO } from "@/lib/hup-calendar/hebrew-date";
import { DAY_YI, shabbosEnds, yiddishCallDay, yiddishDay, yiddishMoment } from "@/lib/yiddish-day";

/* Yiddish day + parsha on staff screens (Abraham Y, Z, AA, BB). hebcal is a test-only dev dependency. */

const EN = ["Bereshit", "Noach", "Lech-Lecha", "Vayera", "Chayei Sara", "Toldot", "Vayetzei", "Vayishlach", "Vayeshev", "Miketz", "Vayigash", "Vayechi", "Shemot", "Vaera", "Bo", "Beshalach", "Yitro", "Mishpatim", "Terumah", "Tetzaveh", "Ki Tisa", "Vayakhel", "Pekudei", "Vayikra", "Tzav", "Shmini", "Tazria", "Metzora", "Achrei Mot", "Kedoshim", "Emor", "Behar", "Bechukotai", "Bamidbar", "Nasso", "Beha'alotcha", "Sh'lach", "Korach", "Chukat", "Balak", "Pinchas", "Matot", "Masei", "Devarim", "Vaetchanan", "Eikev", "Re'eh", "Shoftim", "Ki Teitzei", "Ki Tavo", "Nitzavim", "Vayeilech", "Ha'azinu"];
const isoOf = (d: HDate) => {
  const g = d.greg();
  return `${g.getFullYear()}-${String(g.getMonth() + 1).padStart(2, "0")}-${String(g.getDate()).padStart(2, "0")}`;
};
const ny = (local: string) => {
  // "2026-11-12T03:00" New York (EST in November) -> Date
  const d = new Date(`${local}:00-05:00`);
  return d;
};

describe("parsha matches hebcal (diaspora)", () => {
  it("every Shabbos for 140 years (5760-5899): doubles, Yom Tov weeks, Nasso before Shavuos, Vayeilech in Tishrei", () => {
    const bad: string[] = [];
    let n = 0;
    for (let y = 5760; y < 5900; y++) {
      const s = getSedra(y, false);
      let d = new HDate(1, "Tishrei", y).onOrAfter(6);
      const end = new HDate(1, "Tishrei", y + 1);
      while (d.deltaDays(end) < 0) {
        const r = s.lookup(d);
        const mine = readingOn(fixedFromISO(isoOf(d)));
        const a = "yomTov" in mine ? "CHAG" : mine.parsha.map((p) => EN[p]).join("-");
        const b = r.chag ? "CHAG" : r.parsha.join("-");
        if (a !== b) bad.push(`${isoOf(d)} ${a} vs ${b}`);
        n++;
        d = d.add(7, "d");
      }
    }
    expect(n).toBeGreaterThan(7000);
    expect(bad).toEqual([]);
  });

  it("the coming year, day by day (5787)", () => {
    let d = new HDate(1, "Tishrei", 5787);
    const end = new HDate(1, "Tishrei", 5788);
    const s = getSedra(5787, false);
    while (d.deltaDays(end) < 0) {
      const shabbos = d.onOrAfter(6);
      const r = s.lookup(shabbos);
      const label = yiddishDay(isoOf(d));
      if (!r.chag) expect(label).toMatch(/, פרשת /);
      else expect(label).not.toMatch(/פרשת/);
      d = d.next();
    }
  });
});

describe("Abraham's spellings and examples", () => {
  it("day names (Z)", () => {
    expect(DAY_YI).toEqual(["זונטאג", "מאנטאג", "דינסטאג", "מיטוואך", "דאנערשטאג", "פרייטאג", "שבת קודש"]);
  });
  it("plain days: the week is named for the coming Shabbos; Saturday stays שבת קודש in a day cell", () => {
    expect(yiddishDay("2026-11-01")).toBe("זונטאג, פרשת חיי שרה"); // Shabbos Nov 7 = Chayei Sara
    expect(yiddishDay("2026-11-07")).toBe("שבת קודש, פרשת חיי שרה");
    expect(yiddishDay("2026-11-08")).toBe("זונטאג, פרשת תולדות");
    expect(yiddishDay("2026-09-27")).toBe("זונטאג, שמיני עצרת"); // Yom Tov week: Shabbos Oct 3, 2026 is Shemini Atzeres
    expect(yiddishDay("2026-10-04")).toBe("זונטאג, פרשת בראשית");
    expect(yiddishDay("2026-07-06")).toBe("מאנטאג, פרשת מטות-מסעי"); // a double parsha (Shabbos Jul 11, 2026)
  });
  it("Motzei Shabbos (AA): after Shabbos ends in Monroe, next week's parsha", () => {
    const ends = shabbosEnds("2026-11-07");
    expect(ends.getUTCHours()).toBe(22); // about 5:15 PM EST
    expect(yiddishMoment(new Date(ends.getTime() - 60_000))).toBe("שבת קודש, פרשת חיי שרה");
    expect(yiddishMoment(new Date(ends.getTime() + 60_000))).toBe("מוצאי שבת קודש, פרשת תולדות");
  });
  it("call log (BB): the day turns at 6 AM; night and morning labels; Motzei Shabbos before 6 AM Sunday", () => {
    expect(yiddishCallDay(ny("2026-11-12T03:00"))).toMatchObject({ label: "מיטוואך ביינאכט", part: "night" }); // Thursday 3 AM
    expect(yiddishCallDay(ny("2026-11-12T06:30"))).toMatchObject({ label: "דאנערשטאג אינדערפרי", part: "morning" });
    expect(yiddishCallDay(ny("2026-11-12T14:00"))).toMatchObject({ label: "דאנערשטאג", part: null });
    expect(yiddishCallDay(ny("2026-11-08T02:00"))).toMatchObject({ label: "מוצאי שבת קודש", parsha: "פרשת תולדות" });
    expect(yiddishCallDay(ny("2026-11-07T21:00"))).toMatchObject({ label: "מוצאי שבת קודש", parsha: "פרשת תולדות" });
    expect(yiddishCallDay(ny("2026-11-07T03:00"))).toMatchObject({ label: "פרייטאג ביינאכט" });
  });
});

describe("screens only", () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));
  it("never on the phone line, the public website, texts or emails", () => {
    const allowed = /src\/(app\/admin|components\/(DualDate|DateRangeHeading|DateInputHints|CallYiddishDay|MyTasksCard)\.tsx|lib\/(yiddish-day|tasks-reports|week-heading|hup-calendar\/parsha)\.ts)/; // staff screens and staff exports only
    for (const f of files("src")) {
      const t = readFileSync(f, "utf8");
      if (/yiddish-day|hup-calendar\/parsha|YiddishDay|CallYiddishDay/.test(t)) expect(f).toMatch(allowed);
    }
    expect(readFileSync("src/app/pay/[orderId]/page.tsx", "utf8")).not.toMatch(/<DualDate yi/);
    expect(readFileSync("src/components/CallYiddishDay.tsx", "utf8")).toMatch(/import \{ Moon, Sun \} from "lucide-react"/);
    expect(readFileSync("src/components/CallYiddishDay.tsx", "utf8")).not.toMatch(/🌙|☀/);
  });
});
