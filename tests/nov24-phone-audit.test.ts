import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PROMPTS } from "@/lib/ivr/prompts";
import { MAIN_MENU_KEYS } from "@/lib/ivr/main-menu-keys";

/* Hark's Admin PHONE SYSTEM audit (Nov 24, 2026, 11:06 AM). */
describe("1. one main menu key map everywhere", () => {
  it("the key list says what the live main menu line says, key by key", () => {
    const menu = (PROMPTS.main_menu.text as string).split("\n");
    const lineFor = (k: string) => menu.find((l) => l.endsWith(`press ${k}.`)) ?? "";
    const words: Record<string, RegExp> = { "1": /bookings/i, "2": /instructions/i, "3": /customer service/i, "4": /issues during your rental/i, "5": /delivery and pickup/i, "6": /learn more/i, "7": /hours/i, "8": /catalog/i, "9": /feedback/i };
    const labels: Record<string, RegExp> = { "1": /bookings/i, "2": /instructions/i, "3": /customer service/i, "4": /during a rental/i, "5": /delivery and pickup/i, "6": /learn/i, "7": /hours/i, "8": /catalog/i, "9": /feedback/i };
    for (const [k, re] of Object.entries(words)) {
      expect(lineFor(k), `menu key ${k}`).toMatch(re);
      expect(MAIN_MENU_KEYS.find(([key]) => key === k)?.[1], `label key ${k}`).toMatch(labels[k]);
    }
  });
  it("the Dashboard legend, the Prompts filter and the call journey use it (no old key numbers)", () => {
    expect(readFileSync("src/app/admin/(app)/CallsCard.tsx", "utf8")).toContain("MAIN_MENU_KEYS.map");
    const prompts = readFileSync("src/app/admin/(app)/phone/prompts/page.tsx", "utf8") + readFileSync("src/lib/ivr/prompts.ts", "utf8");
    expect(prompts).not.toContain("Key 4: Learn");
    expect(prompts).not.toContain("Keys 0, 3, 5, 6");
    expect(prompts).toContain("Key 6: Learn about our rentals");
    expect(readFileSync("src/lib/call-journey.ts", "utf8")).toContain("Learn about our rentals (key 6)");
  });
});
