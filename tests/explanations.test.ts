import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { SETTING_DEFAULTS } from "@/lib/settings";
import { CONFIG_EXPLANATIONS } from "@/lib/config-explanations";
import { configDefs } from "@/lib/config-registry";
import { SCREENS } from "@/lib/ivr/screens";
import { SCREEN_EXPLANATIONS } from "@/lib/ivr/screen-explanations";

/* Abraham, Nov 26, 2026, 3:19 AM and 3:20 AM build rules: every Admin setting and every phone screen has a plain-English
 * explanation (what it does, where it is met, what happens if changed; the current value is shown beside it). No code
 * words or unexplained abbreviations. Bookkeeping settings go deeper (source, calculation, a dollar example), and
 * anything about tax says to ask the accountant. */
const ABBREV = /\b(SMS|MMS|JSON|URL|API|GL|DST|IVR|TTS|ACH|EIN|CPA|PIN|ID|PDF|POS|AR|AP|e\.g|i\.e|etc)\b/;
const CODE = /(\{\{|=>|\bnull\b|\bundefined\b|\btrue\b|\bfalse\b|[a-z][A-Z][a-z]+[A-Z])/;
const filled = (s: string | undefined) => (s ?? "").trim().length >= 12;

describe("every Admin setting is explained", () => {
  const keys = Object.keys(SETTING_DEFAULTS);
  it.each(keys)("%s has what, where and if-changed, in plain English", (k) => {
    const e = CONFIG_EXPLANATIONS[k];
    expect(e, `${k} has no explanation`).toBeTruthy();
    for (const part of ["what", "where", "ifChanged"] as const) {
      expect(filled(e[part]), `${k}.${part} is empty`).toBe(true);
      expect(e[part], `${k}.${part} uses an abbreviation`).not.toMatch(ABBREV);
      expect(e[part], `${k}.${part} uses a code word`).not.toMatch(CODE);
    }
  });
  it("the All settings page shows each part and the current value", () => {
    const page = readFileSync("src/app/admin/(app)/config/page.tsx", "utf8");
    for (const s of ["What it does:", "Where it is used:", "Now:", "If you change it:", "Example:", "ACCOUNTANT_NOTE"]) expect(page).toContain(s);
    expect(configDefs().every((d) => d.explain && d.help)).toBe(true);
  });
});

describe("bookkeeping settings get the deeper explanation", () => {
  const books = ["solaFeePercent", "solaFeeCents", "bookReminderDays", "bookOpeningCashCents", "bookOpeningDate", "glChartApprovedBy", "glChartApprovedOn", "glFiscalYearStartMonth", "glAccountingMethod", "glBaseCurrency", "glApprovalThresholdCents"];
  it.each(books)("%s: source, calculation and a worked example", (k) => {
    const e = CONFIG_EXPLANATIONS[k];
    expect(filled(e.source) && filled(e.calculation) && filled(e.example), k).toBe(true);
    for (const v of [e.source, e.calculation, e.example]) expect(v).not.toMatch(ABBREV);
  });
  it("money examples use dollar amounts", () => {
    for (const k of ["solaFeePercent", "solaFeeCents", "bookOpeningCashCents", "glApprovalThresholdCents", "salesTaxPercent", "glAccountingMethod"]) expect(CONFIG_EXPLANATIONS[k].example, k).toMatch(/\$\d/);
  });
  it("tax-related settings say to ask the accountant", () => {
    for (const k of ["salesTaxPercent", "glAccountingMethod", "glFiscalYearStartMonth", "glChartApprovedBy"]) expect(CONFIG_EXPLANATIONS[k].askAccountant, k).toBe(true);
  });
  it("the sales tax example adds up", () => {
    expect(CONFIG_EXPLANATIONS.salesTaxPercent.example).toContain("$17.47");
    expect(Math.round(21500 * 0.08125) / 100).toBe(17.47);
  });
});

describe("every phone screen is explained", () => {
  it.each(Object.keys(SCREENS))("%s has what, where and if-changed", (id) => {
    const e = SCREEN_EXPLANATIONS[id];
    expect(e, `${id} has no explanation`).toBeTruthy();
    for (const part of ["what", "where", "ifChanged"] as const) {
      expect(filled(e[part]), `${id}.${part} is empty`).toBe(true);
      expect(e[part], `${id}.${part} uses an abbreviation`).not.toMatch(ABBREV);
    }
  });
  it("no explanation for a screen that does not exist", () => {
    expect(Object.keys(SCREEN_EXPLANATIONS).filter((id) => !(id in SCREENS))).toEqual([]);
  });
  it("the Screens pages show the explanation", () => {
    expect(readFileSync("src/app/admin/(app)/phone/screens/[id]/page.tsx", "utf8")).toContain("data-screen-explain");
    expect(readFileSync("src/app/admin/(app)/phone/screens/page.tsx", "utf8")).toContain("data-screen-what");
  });
});
