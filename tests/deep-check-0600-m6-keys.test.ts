import { afterAll, describe, expect, it, vi } from "vitest";

/* Deep check 06:00 M6 (payment-link menu, box 141): every key path. Star goes to a card payment only when one is offered
   to the caller; pound, a wrong key and no key replay the menu with the not-valid line; on Shabbes the cut-off stops it. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));
vi.mock("@/lib/notify", () => ({ sendSms: async () => ({ sent: true }), sendEmail: async () => ({ sent: true }) }));

import { handleVoice } from "@/lib/ivr/flow";
import { saveSetting } from "@/lib/settings";
import { erevCandleLighting } from "@/lib/jewish-calendar";
import { getSettings } from "@/lib/settings";

const call = (body: Record<string, string>) => handleVoice({ action: "paylink-choice", query: new URLSearchParams("o=12"), body: { CallSid: "CAm6keys", ...body }, callSid: "CAm6keys", from: "+18455550191" });
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace(/^.*\/api\/voice\//, "").replace(/&amp;/g, "&");
const PINNED = process.env.HUP_CALENDAR_NOW;
afterAll(() => void (process.env.HUP_CALENDAR_NOW = PINNED));

describe("deep check 06:00 M6: box 141 key paths", () => {
  it("star, card offered (Sola): the card offer, then the payment line", async () => {
    process.env.PUBLIC_BASE_URL = "https://hupup.example";
    process.env.SOLA_PHONEPAY_PIN = "4321";
    const xml = await call({ Digits: "*" });
    expect(xml).toContain("phonepay-option?o=12");
    expect(redirect(xml)).toBe("phonepay-go?o=12&c=1");
  });
  it("star, card offered only to Owner test numbers: this caller is not one, so not valid and box 141 again", async () => {
    await saveSetting("solaPhonePayOwnerOnly", "true");
    const xml = await call({ Digits: "*" });
    expect(xml).not.toContain("phonepay-option");
    expect(redirect(xml)).toBe("paylink?o=12");
    await saveSetting("solaPhonePayOwnerOnly", "false");
  });
  it("star, phone cards switched off: never dials Sola", async () => {
    await saveSetting("solaPhonePayOn", "false");
    const xml = await call({ Digits: "*" });
    expect(xml).not.toContain("<Dial");
    expect(redirect(xml)).toBe("paylink?o=12");
    await saveSetting("solaPhonePayOn", "true");
  });
  it("pound, a wrong key and no key: the not-valid line, then box 141 again", async () => {
    for (const d of ["#", "5", ""]) {
      const xml = await call(d ? { Digits: d } : {});
      expect(xml).toMatch(/not a valid|not valid/i);
      expect(redirect(xml)).toBe("paylink?o=12");
    }
  });
  it("1 and 2 still go to the text and email steps", async () => {
    expect(redirect(await call({ Digits: "1" }))).toBe("tx-which?p=pay&o=12");
    expect(redirect(await call({ Digits: "2" }))).toBe("catalog-email?p=pay&o=12");
  });
  it("Shabbes: after the cut-off star never reaches a payment", async () => {
    const candles = erevCandleLighting("2027-01-15", (await getSettings()) as never)!;
    process.env.HUP_CALENDAR_NOW = new Date(candles.getTime() - 5 * 60_000).toISOString();
    const xml = await call({ Digits: "*" });
    expect(xml).not.toContain("phonepay-go");
    expect(xml).not.toContain("<Dial");
    process.env.HUP_CALENDAR_NOW = PINNED;
  });
});
