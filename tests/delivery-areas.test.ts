import { describe, expect, it, vi } from "vitest";

/* Delivery fees by map area (Abraham, Nov 15, 2026). In-memory database; the address service is a stand-in. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { db, schema } from "@/lib/db";
import { areaAt, deliveryPromoActive, deliveryQuote, mergeAreas, parseKml, spellingHint, withState, zoneFee } from "@/lib/delivery-areas";
import { SETTING_DEFAULTS } from "@/lib/settings";

const square = (x: number, y: number, d: number) => `${x},${y},0 ${x + d},${y},0 ${x + d},${y + d},0 ${x},${y + d},0 ${x},${y},0`;
const pm = (name: string, coords: string, desc = "") => `<Placemark><name>${name}</name>${desc ? `<description>${desc}</description>` : ""}<Polygon><outerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`;
// A big "Local Town" area with a small "Local" area inside it, Chester (the map says $20), and Ruach Hchaim
const KML = `<?xml version="1.0"?><kml><Document><name>Price list</name>
<Folder><name>$15</name>${pm("Local Town", square(-74.2, 41.3, 0.1))}${pm("Chester $20", square(-74.3, 41.3, 0.05))}</Folder>
<Folder><name>$10</name>${pm("Local", square(-74.17, 41.33, 0.02))}</Folder>
<Folder><name>$20</name>${pm("Ruach Hchaim", square(-74.0, 41.5, 0.02))}</Folder>
</Document></kml>`;

const census = (lng: number, lat: number) => (async () => new Response(JSON.stringify({ result: { addressMatches: [{ coordinates: { x: lng, y: lat } }] } }))) as unknown as typeof fetch;
const nowhere = (async () => new Response(JSON.stringify({ result: { addressMatches: [] } }))) as unknown as typeof fetch;

describe("delivery price map", () => {
  const areas = parseKml(KML);
  const s = { ...SETTING_DEFAULTS, deliveryAreas: JSON.stringify(areas) };

  it("prices follow Abraham's rule, never the map labels: KJ line $10, any other colored area $15 (Chester, Ruach Hchaim too)", () => {
    expect(areas.map((a) => [a.name, a.priceCents])).toEqual([
      ["Local Town", 1500],
      ["Chester", 1500],
      ["Local", 1000],
      ["Ruach Hchaim", 1500],
    ]);
  });

  it("the house decides: two houses on the same street get different prices; on a zone line the lower price", async () => {
    // Main Street crosses from Local ($10) into Local Town ($15)
    expect(await deliveryQuote("10 Main Street, Kiryas Joel, NY 10950", s, census(-74.16, 41.34))).toMatchObject({ ok: true, feeCents: 1000 });
    expect(await deliveryQuote("40 Main Street, Monroe, NY 10950", s, census(-74.12, 41.34))).toMatchObject({ ok: true, feeCents: 1500 });
    // Exactly on the Local line (x = -74.17), from the Local Town side: the lower price
    expect(areaAt(-74.17005, 41.34, areas)?.name).toBe("Local");
  });

  it("the street list only checks spelling", () => {
    expect(spellingHint("12 Karlsberg Rd, Monroe", "Karlsburg Road\nSatmar Drive")).toBe("Karlsburg Road");
    expect(spellingHint("12 Satmar Dr", "Karlsburg Road\nSatmar Drive")).toBeNull(); // spelled right
  });

  it("the fee is the area the address falls in; where shapes overlap the lower price wins", () => {
    expect(areaAt(-74.16, 41.34, areas)?.name).toBe("Local"); // inside both: Local is smaller
    expect(areaAt(-74.11, 41.31, areas)?.name).toBe("Local Town");
    expect(areaAt(-74.28, 41.32, areas)?.name).toBe("Chester");
    expect(areaAt(-73.99, 41.51, areas)?.name).toBe("Ruach Hchaim");
    expect(areaAt(-73.5, 42.6, areas)).toBeNull();
  });

  it("one address in each area is priced by the rule; outside every colored area $20; not found = ask again", async () => {
    expect(await deliveryQuote("1 Local St, Kiryas Joel", s, census(-74.16, 41.34))).toMatchObject({ ok: true, zone: "Local", feeCents: 1000 });
    expect(await deliveryQuote("2 Town Rd, Monroe", s, census(-74.11, 41.31))).toMatchObject({ ok: true, zone: "Local Town", feeCents: 1500 });
    expect(await deliveryQuote("3 Main St, Chester", s, census(-74.28, 41.32))).toMatchObject({ ok: true, zone: "Chester", feeCents: 1500 });
    expect(await deliveryQuote("4 Ruach Way, Monroe", s, census(-73.99, 41.51))).toMatchObject({ ok: true, zone: "Ruach Hchaim", feeCents: 1500 });
    expect(await deliveryQuote("25 Main Street, Goshen", s, census(-74.32, 41.40))).toMatchObject({ ok: true, zone: "Anywhere else in Orange County", feeCents: 2000 });
    expect(await deliveryQuote("nowhere at all", s, nowhere)).toMatchObject({ ok: false, reason: "not_found" });
    expect(await deliveryQuote("", s)).toMatchObject({ ok: false, reason: "no_address" });
  });

  it("each address is looked up once (saved), and New York is added when no state is given", async () => {
    let calls = 0;
    const counting = (async () => (calls++, new Response(JSON.stringify({ result: { addressMatches: [{ coordinates: { x: -74.11, y: 41.31 } }] } })))) as unknown as typeof fetch;
    await deliveryQuote("9 Saved Lane, Monroe", s, counting);
    await deliveryQuote("9 saved lane,  monroe", s, counting);
    expect(calls).toBe(1);
    expect((await db.select().from(schema.geocodeCache)).some((r) => r.address === "9 saved lane, monroe")).toBe(true);
    expect(withState("12 Forest Road, Monroe")).toBe("12 Forest Road, Monroe, NY");
    expect(withState("12 Forest Road, Monroe, NY 10950")).toBe("12 Forest Road, Monroe, NY 10950");
  });

  it("reloading the map keeps the Owner's own names; a price typed anywhere never changes the rule", async () => {
    const edited = areas.map((a) => (a.name === "Local" ? { ...a, name: "Kiryas Joel", priceCents: 1200 } : a));
    const merged = mergeAreas(parseKml(KML), edited);
    expect(merged.find((a) => a.mapName === "Local")).toMatchObject({ name: "Kiryas Joel", priceCents: 1000 });
    expect(await deliveryQuote("7 Local St, Kiryas Joel", { ...s, deliveryAreas: JSON.stringify(edited) }, census(-74.16, 41.34))).toMatchObject({ feeCents: 1000 });
  });

  it("the saved map reads back as the map (it once read back empty, so the town rule was used by mistake)", async () => {
    const { getSettings, saveSetting } = await import("@/lib/settings");
    await saveSetting("deliveryAreas", JSON.stringify(areas), null);
    const back = (await getSettings()).deliveryAreas;
    expect(JSON.parse(back)).toHaveLength(4);
    expect(await deliveryQuote("4 Ruach Way, Monroe", await getSettings(), census(-73.99, 41.51))).toMatchObject({ ok: true, zone: "Ruach Hchaim", feeCents: 1500 });
  });

  it("before the map is loaded, the town-name rule still works", async () => {
    expect(await deliveryQuote("5 Main St, Chester NY", { ...SETTING_DEFAULTS, deliveryAreas: "" })).toMatchObject({ ok: true, zone: "area", feeCents: 1500 });
  });
});

describe("zone prices, Orange County only, and the free delivery promo (Abraham, Nov 17, 2026)", () => {
  /** Census stand-in: the address spot, and the county for that spot. */
  const censusIn = (lng: number, lat: number, county: string) =>
    (async (u: string) =>
      new Response(JSON.stringify(u.includes("/geographies/") ? { result: { geographies: { Counties: [{ GEOID: county }] } } } : { result: { addressMatches: [{ coordinates: { x: lng, y: lat } }] } }))) as unknown as typeof fetch;
  it("the three prices are the Owner's, with $10, $15 and $20 as the defaults", () => {
    expect([zoneFee("local"), zoneFee("area"), zoneFee("outside")]).toEqual([1000, 1500, 2000]);
    expect(zoneFee("outside", { deliveryFeeOutsideCents: "2500" })).toBe(2500);
    expect(zoneFee("local", { deliveryFeeKjCents: "1200" })).toBe(1200);
  });
  it("outside every colored area: $20 inside Orange County, NY; refused anywhere else", async () => {
    const areas = parseKml(KML);
    const s = { ...SETTING_DEFAULTS, deliveryAreas: JSON.stringify(areas) };
    expect(await deliveryQuote("9 Far Road, Warwick", s, censusIn(-74.36, 41.25, "36071"))).toMatchObject({ ok: true, zone: "Anywhere else in Orange County", feeCents: 2000 });
    expect(await deliveryQuote("9 Far Road, Suffern", s, censusIn(-74.15, 41.11, "36087"))).toMatchObject({ ok: false, reason: "outside" });
  });
  it("the promo: KJ free, nearby towns $10, the $20 zone unchanged; only within its dates; off = regular prices", () => {
    const on = { deliveryPromoOn: true, deliveryPromoStart: "2026-11-20", deliveryPromoEnd: "2026-11-30" };
    const inside = new Date("2026-11-25T17:00:00Z");
    expect(deliveryPromoActive(on, inside)).toBe(true);
    expect([zoneFee("local", on, inside), zoneFee("area", on, inside), zoneFee("outside", on, inside)]).toEqual([0, 1000, 2000]);
    expect(deliveryPromoActive(on, new Date("2026-12-01T17:00:00Z"))).toBe(false);
    expect(deliveryPromoActive(on, new Date("2026-11-19T17:00:00Z"))).toBe(false);
    expect(zoneFee("local", { ...on, deliveryPromoOn: false }, inside)).toBe(1000);
    expect(deliveryPromoActive({ deliveryPromoOn: true }, inside)).toBe(true); // no dates: on until switched off
  });
  it("the promo price is what the phone line, New booking and the payment total charge (all use deliveryQuote)", async () => {
    const areas = parseKml(KML);
    const s = { ...SETTING_DEFAULTS, deliveryAreas: JSON.stringify(areas), deliveryPromoOn: true };
    expect(await deliveryQuote("1 Local St, Kiryas Joel", s, censusIn(-74.16, 41.34, "36071"))).toMatchObject({ ok: true, zone: "Local", feeCents: 0 });
    expect(await deliveryQuote("2 Town Rd, Monroe", s, censusIn(-74.11, 41.31, "36071"))).toMatchObject({ ok: true, zone: "Local Town", feeCents: 1000 });
    const { priceOrder } = await import("@/lib/pricing");
    const t = await priceOrder(10000, "1 Local St, Kiryas Joel", s as never, censusIn(-74.16, 41.34, "36071"));
    expect(t?.deliveryFeeCents).toBe(0);
  });
});
