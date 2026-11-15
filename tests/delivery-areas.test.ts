import { describe, expect, it, vi } from "vitest";

/* Delivery fees by map area (Abraham, Nov 15, 2026). In-memory database; the address service is a stand-in. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { db, schema } from "@/lib/db";
import { areaAt, deliveryQuote, mergeAreas, parseKml, spellingHint, withState } from "@/lib/delivery-areas";
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

  it("reads every area and its price; Chester is $15 (Abraham changed it from the map's $20)", () => {
    expect(areas.map((a) => [a.name, a.priceCents])).toEqual([
      ["Local Town", 1500],
      ["Chester", 1500],
      ["Local", 1000],
      ["Ruach Hchaim", 2000],
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

  it("one address in each area is priced from the map; outside every area or not found = no price (staff quote)", async () => {
    expect(await deliveryQuote("1 Local St, Kiryas Joel", s, census(-74.16, 41.34))).toEqual({ ok: true, zone: "Local", feeCents: 1000 });
    expect(await deliveryQuote("2 Town Rd, Monroe", s, census(-74.11, 41.31))).toEqual({ ok: true, zone: "Local Town", feeCents: 1500 });
    expect(await deliveryQuote("3 Main St, Chester", s, census(-74.28, 41.32))).toEqual({ ok: true, zone: "Chester", feeCents: 1500 });
    expect(await deliveryQuote("4 Ruach Way, Monroe", s, census(-73.99, 41.51))).toEqual({ ok: true, zone: "Ruach Hchaim", feeCents: 2000 });
    expect(await deliveryQuote("1 Main Street, Albany", s, census(-73.75, 42.65))).toEqual({ ok: false, reason: "outside" });
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

  it("reloading the map keeps the Owner's own names and prices", () => {
    const edited = areas.map((a) => (a.name === "Local" ? { ...a, name: "Kiryas Joel", priceCents: 1200 } : a));
    const merged = mergeAreas(parseKml(KML), edited);
    expect(merged.find((a) => a.mapName === "Local")).toMatchObject({ name: "Kiryas Joel", priceCents: 1200 });
  });

  it("the saved map reads back as the map (it once read back empty, so the town rule was used by mistake)", async () => {
    const { getSettings, saveSetting } = await import("@/lib/settings");
    await saveSetting("deliveryAreas", JSON.stringify(areas), null);
    const back = (await getSettings()).deliveryAreas;
    expect(JSON.parse(back)).toHaveLength(4);
    expect(await deliveryQuote("4 Ruach Way, Monroe", await getSettings(), census(-73.99, 41.51))).toEqual({ ok: true, zone: "Ruach Hchaim", feeCents: 2000 });
  });

  it("before the map is loaded, the town-name rule still works", async () => {
    expect(await deliveryQuote("5 Main St, Chester NY", { ...SETTING_DEFAULTS, deliveryAreas: "" })).toEqual({ ok: true, zone: "area", feeCents: 1500 });
  });
});
