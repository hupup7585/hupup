import { describe, expect, it, vi } from "vitest";

/* Delivery fees/zones and sales tax are editable by the Owner (Delivery settings / General settings). In-memory DB. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/auth", () => ({ requireOwner: async () => ({ userId: 1, role: "owner", name: "Abraham Schwartz", phone: "+18457777585" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { db, schema } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { saveDeliveryPricingAction, saveSalesTaxAction } from "@/app/admin/(app)/settings/pricing-actions";

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

describe("delivery and tax settings", () => {
  it("saves fees in cents and zone towns one per line, with an audit row", async () => {
    const r = await saveDeliveryPricingAction(null, fd({ deliveryFeeKj: "$12", deliveryFeeArea: "17.50", zoneKjPlaces: "Kiryas Joel\n\n  Palm Tree ", zoneAreaPlaces: "Monroe\nChester" }));
    expect(r?.ok).toBe(true);
    const s = await getSettings();
    expect([s.deliveryFeeKjCents, s.deliveryFeeAreaCents, s.zoneKjPlaces, s.zoneAreaPlaces].map(String)).toEqual(["1200", "1750", "Kiryas Joel\nPalm Tree", "Monroe\nChester"]);
    const audit = await db.select().from(schema.auditLog);
    expect(audit.some((a) => a.action === "settings.delivery_pricing_updated")).toBe(true);
  });

  it("refuses bad amounts and an empty Kiryas Joel zone", async () => {
    expect((await saveDeliveryPricingAction(null, fd({ deliveryFeeKj: "ten", deliveryFeeArea: "15", zoneKjPlaces: "KJ", zoneAreaPlaces: "" })))?.ok).toBe(false);
    expect((await saveDeliveryPricingAction(null, fd({ deliveryFeeKj: "10", deliveryFeeArea: "15", zoneKjPlaces: " ", zoneAreaPlaces: "" })))?.ok).toBe(false);
    expect(String((await getSettings()).deliveryFeeKjCents)).toBe("1200");
  });

  it("sales tax: a percent up to 25", async () => {
    expect((await saveSalesTaxAction(null, fd({ salesTaxPercent: "8.375%" })))?.ok).toBe(true);
    expect(String((await getSettings()).salesTaxPercent)).toBe("8.375");
    expect((await saveSalesTaxAction(null, fd({ salesTaxPercent: "80" })))?.ok).toBe(false);
  });
});
