import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { englishFullDate, parshaEnglish, rangeHeading, yiddishFullDate, PARSHIYOS_EN } from "@/lib/week-heading";
import { PARSHIYOS } from "@/lib/hup-calendar/parsha";
import DateRangeHeading from "@/components/DateRangeHeading";

/* Availability / date-range heading (Abraham): title, parsha once, From and To lines, English first, Yiddish RTL and gray. */
describe("date range heading", () => {
  it("matches Abraham's example exactly", () => {
    expect(rangeHeading("2026-11-08", "2026-11-14")).toEqual({
      week: { en: "Week of Parshas Toldos", he: "פרשת תולדות" },
      from: { en: "Sunday, November 8, 2026", he: "זונטאג, כ״ח חשון" },
      to: { en: "Shabbos, November 14, 2026", he: "שבת קודש, ד׳ כסלו" },
    });
  });

  it("several weeks: the parsha line still appears once", () => {
    expect(rangeHeading("2026-11-08", "2026-11-21").week.en).toBe("Weeks of Parshas Toldos to Parshas Vayeitzei");
  });

  it("every parsha has an English name; double parshiyos and Yom Tov work", () => {
    expect(PARSHIYOS_EN).toHaveLength(PARSHIYOS.length);
    expect(parshaEnglish("פרשת ויקהל-פקודי")).toBe("Parshas Vayakhel-Pekudei");
    expect(parshaEnglish("חול המועד פסח")).toBe("Chol Hamoed Pesach");
    expect(englishFullDate("2026-11-14")).toBe("Shabbos, November 14, 2026");
    expect(yiddishFullDate("2026-11-13")).toBe("פרייטאג, ג׳ כסלו");
  });

  it("renders title, one parsha line, From/To lines; no slashes; Yiddish in its own RTL gray smaller span", () => {
    const html = renderToStaticMarkup(createElement(DateRangeHeading, { title: "Availability", from: "2026-11-08", to: "2026-11-14" }));
    expect(html).toContain("<h1");
    expect(html.match(/פרשת תולדות/g)).toHaveLength(1);
    expect(html).toContain("From:</span> <span>Sunday, November 8, 2026</span>");
    expect(html).toContain("To:</span> <span>Shabbos, November 14, 2026</span>");
    expect(html).not.toContain(" / ");
    const yi = html.match(/<span dir="rtl" lang="yi" data-yi="true" class="([^"]+)">/g)!;
    expect(yi).toHaveLength(3);
    expect(yi[0]).toContain("text-[0.85em]");
    expect(yi[0]).toContain("text-[#6B7A90]");
    const cal = readFileSync("src/app/admin/(app)/calendar/page.tsx", "utf8");
    expect(cal).toContain('<DateRangeHeading title="Availability" from={start} to={end} />');
    expect(cal).not.toContain("Availability · ");
    expect(readFileSync("src/app/admin/(app)/bookkeeping/print/page.tsx", "utf8")).toContain("<DateRangeHeading from={from} to={to}");
  });
});

describe("calendar columns don't repeat the parsha", () => {
  it("column headers show only the Yiddish day; the parsha is in the heading once", async () => {
    const { HebrewDay } = await import("@/components/DualDate");
    const html = renderToStaticMarkup(createElement(HebrewDay, { iso: "2026-11-08", yi: true, dayOnly: true }));
    expect(html).toContain("זונטאג");
    expect(html).not.toContain("פרשת");
    expect(readFileSync("src/app/admin/(app)/calendar/page.tsx", "utf8")).toContain("<HebrewDay yi dayOnly iso={d}");
  });
});
