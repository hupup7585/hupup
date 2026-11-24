import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { decodeMultitap } from "@/lib/ivr/multitap";
import { PROMPTS } from "@/lib/ivr/prompts";

/* Abraham, Nov 24, 2026: silent keypad typing, ONE decoder for every typing step. */
describe("the one keypad decoder", () => {
  const cases: [string, string][] = [
    ["2*22", "ab"],
    ["2222", "2"],
    ["77777", "7"],
    ["99999", "9"],
    ["233**4", "ag"],
    ["2033", "a e"],
    ["20033", "a0e"],
    ["1", "1"],
    ["11", "."],
    ["111", "-"],
    ["1111", "_"],
  ];
  it("text steps (name, street): every rule as the recording says", () => {
    for (const [keys, want] of cases) expect(decodeMultitap(keys, "text"), keys).toBe(want);
  });
  it("email steps: the same keys, and a space is left out", () => {
    for (const [keys, want] of cases) expect(decodeMultitap(keys, "email"), keys).toBe(want.replace(/ /g, ""));
    expect(decodeMultitap("211*1", "email")).toBe("a.1"); // a.1: 2, 11, star, 1 (1 then 1 is the same key, so star between them)
    expect(decodeMultitap("2111", "email")).toBe("a-"); // without the star, 111 is a dash
  });
  it("two stars erase into text already typed (adding to an email part)", () => {
    expect(decodeMultitap("**3", "email", "ab")).toBe("ad");
  });
  it("one decoder only: the catalog decoder and the echo engine are gone; every typing step uses decodeMultitap", () => {
    expect(readFileSync("src/lib/ivr/catalog-keys.ts", "utf8")).not.toContain("decodeCatalogKeys");
    const flow = readFileSync("src/lib/ivr/flow.ts", "utf8");
    expect(flow).not.toMatch(/ktChar|"kt-key"|keypadEchoOn/);
    expect(flow.match(/decodeMultitap\(/g)?.length).toBe(2); // typed (name, street, checkout email) and catalog-typed (catalog and payment-link email)
    expect(existsSync("src/lib/ivr/keypad-typing.ts")).toBe(false);
  });
  it("type_instructions: Abraham's exact text; nothing says wait one second", () => {
    expect(PROMPTS.type_instructions.text).toBe("Press 2 once for A, twice for B, three times for C, and so on for all keys. If two letters in a row use the same key, press star between them. To type a number, press the key one more time. To go back, press star twice. Press 0 once for a space, and twice for number 0. Press 1 once for number 1, twice for a dot, three times for a dash, and four times for an underscore. When you are finished, press the pound key.");
    expect(readFileSync("src/lib/ivr/multitap.ts", "utf8")).not.toMatch(/wait one second/i);
  });
});
