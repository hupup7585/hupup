import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/* Abram: /sms-terms covers SMS messages only; all business and rental terms go on /terms. */
describe("SMS Terms and business Terms stay separate", () => {
  const sms = readFileSync("src/app/sms-terms/page.tsx", "utf8").replace("Carriers are not liable for delayed or undelivered messages.", "");
  it("/sms-terms has no business or rental terms", () => {
    expect(sms).not.toMatch(/cancell?ation|refund|deposit|weather|life jacket|negligen|waiver|release|permit|insurance|inspection|setup|damage|electronic signature|rental terms|sales tax|delivery fee/i);
  });
  it("rental terms acceptance (business terms) is not tied to the SMS Terms page", () => {
    expect(readFileSync("src/lib/rental-terms.ts", "utf8")).not.toContain("/sms-terms");
  });
});
