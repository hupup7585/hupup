import { describe, expect, it, vi } from "vitest";

/* The Offers page intro (Abraham, Nov 26, 2026): the new line, editable from Admin; nothing else on the page changes. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/auth", () => ({ requireOwner: async () => ({ userId: 1, role: "owner" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { url: u }); } }));

import { readFileSync } from "node:fs";
import { getSettings, SETTING_DEFAULTS } from "@/lib/settings";
import { saveOffersIntroAction } from "@/app/admin/(app)/offers/actions";

const LINE = "Turn each offer on or off here. Customers only get the offers that are on.";
const save = async (text: string) => {
  const fd = new FormData();
  fd.set("offersIntro", text);
  await saveOffersIntroAction(fd).catch((e: { url?: string }) => expect(e.url).toContain("/admin/offers"));
};

describe("Offers page intro", () => {
  it("the new line, exactly, by default; the old line is gone", async () => {
    expect((SETTING_DEFAULTS as Record<string, unknown>).offersIntro).toBe(LINE);
    expect((await getSettings()).offersIntro).toBe(LINE);
    const page = readFileSync("src/app/admin/(app)/offers/page.tsx", "utf8");
    expect(page).toContain("{String(settings.offersIntro || \"\").trim() || \"Turn each offer on or off here. Customers only get the offers that are on.\"}");
    expect(page).not.toContain("Each offer is off until you switch it on.");
  });
  it("editable from Admin (Owner only, audited); empty brings the approved line back", async () => {
    await save("  Our offers,   on or off.  ");
    expect((await getSettings()).offersIntro).toBe("Our offers, on or off.");
    await save("");
    expect((await getSettings()).offersIntro).toBe(LINE);
    expect(readFileSync("src/app/admin/(app)/offers/actions.ts", "utf8")).toMatch(/saveOffersIntroAction[\s\S]*await requireOwner\(\)[\s\S]*settings\.offers_intro_updated/);
  });
  it("nothing else on the page changed: the switches and the holiday rentals are still there", () => {
    const page = readFileSync("src/app/admin/(app)/offers/page.tsx", "utf8");
    for (const s of ['name="laserThirdSetHalfOn"', 'name="offerThuSunOn"', 'name="offerFourthSundayOn"', "Chanukah and Chol Hamoed rentals", "Save offers"]) expect(page).toContain(s);
  });
});
