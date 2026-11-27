import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.setConfig({ testTimeout: 30_000 });

/* Address check with two backups, re-check and Owner text (Abraham, Nov 27, 2026, 2:02-2:12 AM ET). In-memory
 * database; the map services are stand-ins; no real text is sent. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/r2", () => ({ r2Ready: () => false, r2Put: async () => undefined, r2Delete: async () => undefined, r2Get: async () => new Response(null, { status: 404 }) }));
vi.mock("@/lib/voicemail", async (orig) => ({ ...(await orig<typeof import("@/lib/voicemail")>()), mainBox: async () => ({ notifySms: ["+18455550999"], notifyEmail: [] }) }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { deliveryQuote, lookupAddress, parseKml } from "@/lib/delivery-areas";
import { nextCheckAt, noteAddressCheck, runAddressChecks } from "@/lib/address-checks";
import { SETTING_DEFAULTS, saveSetting } from "@/lib/settings";

const square = (x: number, y: number, d: number) => `${x},${y},0 ${x + d},${y},0 ${x + d},${y + d},0 ${x},${y + d},0 ${x},${y},0`;
const pm = (name: string, coords: string) => `<Placemark><name>${name}</name><Polygon><outerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`;
const KML = `<kml><Document><Folder>${pm("Local Town", square(-74.2, 41.3, 0.1))}${pm("Local", square(-74.17, 41.33, 0.02))}</Folder></Document></kml>`;
const areas = parseKml(KML);
const S = { ...SETTING_DEFAULTS, deliveryAreas: JSON.stringify(areas) };

type Svc = "ok" | "fail" | "none";
const services = (g: Svc, c: Svc, o: Svc, at: [number, number] = [-74.16, 41.34]) => {
  const calls: string[] = [];
  const f = (async (url: string) => {
    const u = String(url);
    const name = u.includes("googleapis") ? "google" : u.includes("census.gov") ? "census" : "openstreetmap";
    calls.push(name);
    const mode = name === "google" ? g : name === "census" ? c : o;
    if (mode === "fail") throw new Error("timeout");
    if (name === "google") return new Response(JSON.stringify(mode === "ok" ? { status: "OK", results: [{ geometry: { location: { lng: at[0], lat: at[1] } }, address_components: [{ long_name: "Orange County", types: ["administrative_area_level_2"] }, { long_name: "New York", types: ["administrative_area_level_1"] }] }] } : { status: "ZERO_RESULTS", results: [] }));
    if (name === "census") return new Response(JSON.stringify({ result: { addressMatches: mode === "ok" ? [{ coordinates: { x: at[0], y: at[1] }, geographies: { Counties: [{ GEOID: "36071" }] } }] : [] } }));
    return new Response(JSON.stringify(mode === "ok" ? [{ lat: String(at[1]), lon: String(at[0]), address: { county: "Orange County", state: "New York" } }] : []));
  }) as unknown as typeof fetch;
  return { f, calls };
};

const T0 = new Date("2026-11-17T15:00:00Z"); // a Tuesday, 10 AM in New York
const at = (min: number) => new Date(T0.getTime() + min * 60_000);
const sent: { to: string; body: string }[] = [];
const send = async (to: string, body: string) => (sent.push({ to, body }), { sent: true });

beforeAll(async () => {
  await saveSetting("deliveryAreas", S.deliveryAreas as never, null);
});
afterAll(() => {
  delete process.env.GOOGLE_MAPS_API_KEY;
});

describe("two backup map services", () => {
  it("Google forced to fail: the Census Bureau answers", async () => {
    process.env.GOOGLE_MAPS_API_KEY = "test-key";
    const { f, calls } = services("fail", "ok", "ok");
    const r = await lookupAddress("1 Forest Rd, Monroe, NY", f);
    expect(r.found?.source).toBe("census");
    expect(calls).toEqual(["google", "census"]);
  });
  it("Google and the Census Bureau fail: OpenStreetMap answers", async () => {
    const { f, calls } = services("fail", "fail", "ok");
    const r = await lookupAddress("2 Forest Rd, Monroe, NY", f);
    expect(r.found?.source).toBe("openstreetmap");
    expect(calls).toEqual(["google", "census", "openstreetmap"]);
  });
  it("each backup can be turned off in Admin", async () => {
    const { f, calls } = services("fail", "ok", "ok");
    await lookupAddress("3 Forest Rd, Monroe, NY", f, { census: false });
    expect(calls).toEqual(["google", "openstreetmap"]);
    delete process.env.GOOGLE_MAPS_API_KEY;
  });
  it("all three fail: the booking goes through at the town price, marked not confirmed; nothing saved as 'not found'", async () => {
    const { f } = services("fail", "fail", "fail");
    const q = await deliveryQuote("12 Unknown Lane, Kiryas Joel, NY 10950", S, f, "2026-11-20");
    expect(q).toMatchObject({ ok: true, kind: "local", feeCents: 1000, unconfirmed: true, source: "town" });
    expect(await deliveryQuote("5 Unknown Lane, Monroe, NY 10950", S, f, "2026-11-20")).toMatchObject({ ok: true, kind: "area", feeCents: 1500, unconfirmed: true });
    expect(await deliveryQuote("5 Unknown Lane, Goshen, NY 10924", S, f, "2026-11-20")).toMatchObject({ ok: true, kind: "outside", unconfirmed: true });
    expect(await db.select().from(schema.geocodeCache).where(eq(schema.geocodeCache.address, "12 unknown lane, kiryas joel, ny 10950"))).toEqual([]);
  });
});

describe("re-check and Owner text", () => {
  let orderId = 0;
  it("re-checks at 15, 30, 45 and 60 minutes, then every hour", () => {
    expect(nextCheckAt(T0, T0, S).toISOString()).toBe(at(15).toISOString());
    expect(nextCheckAt(T0, at(15), S).toISOString()).toBe(at(30).toISOString());
    expect(nextCheckAt(T0, at(45), S).toISOString()).toBe(at(60).toISOString());
    expect(nextCheckAt(T0, at(60), S).toISOString()).toBe(at(120).toISOString());
    expect(nextCheckAt(T0, at(120), S).toISOString()).toBe(at(180).toISOString());
  });
  it("an order priced by its town is red 'Address not confirmed yet'; after the first hour (4 tries) ONE Owner text", async () => {
    const [c] = await db.insert(schema.customers).values({ name: "Sara Klein", phone: "+18455550123" }).returning();
    const [o] = await db
      .insert(schema.orders)
      .values({ status: "CONFIRMED", channel: "PHONE", customerId: c.id, eventDate: "2026-11-20", pickupDate: "2026-11-21", deliveryAddress: "12 Unknown Lane, Kiryas Joel, NY 10950", deliveryZone: "Kiryas Joel", deliveryFeeCents: 1000 })
      .returning();
    orderId = o.id;
    await noteAddressCheck(o.id, T0);
    const { addressMarks } = await import("@/lib/address-checks");
    expect((await addressMarks([o.id])).get(o.id)).toBe("Address not confirmed yet");
    const [ord] = await db.select().from(schema.orders).where(eq(schema.orders.id, o.id));
    expect(ord.addressSource).toBe("town");
    const { f } = services("fail", "fail", "fail");
    for (const m of [15, 30, 45]) await runAddressChecks({ fetcher: f, now: at(m), send });
    expect(sent).toHaveLength(0);
    await runAddressChecks({ fetcher: f, now: at(60), send });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("+18455550999");
    expect(sent[0].body).toMatch(/^Hup Up order problem: Address not confirmed after 1 hour\. Order \d+, Sara Klein, \(845\) 555-0123, 12 Unknown Lane, Kiryas Joel, NY 10950, delivery Friday, November 20, delivery charged \$10\.00\.$/);
    const [row] = await db.select().from(schema.addressChecks).where(eq(schema.addressChecks.orderId, o.id));
    expect(row.tries).toBe(4);
    expect(row.nextAt.toISOString()).toBe(at(120).toISOString());
    // not due yet: nothing; then hourly, and never the same text twice
    await runAddressChecks({ fetcher: f, now: at(90), send });
    await runAddressChecks({ fetcher: f, now: at(120), send });
    expect(sent).toHaveLength(1);
  });
  it("a check finding the address does not exist sends that text (once)", async () => {
    const { f } = services("none", "none", "none");
    await runAddressChecks({ fetcher: f, now: at(180), send });
    await runAddressChecks({ fetcher: f, now: at(240), send });
    expect(sent).toHaveLength(2);
    expect(sent[1].body).toMatch(/^Hup Up order problem: Address does not exist\. Order /);
  });
  it("a check finding a different zone sends the zone text; the order stays red; no charge, refund or cancel", async () => {
    const { f } = services("fail", "ok", "fail", [-74.12, 41.36]); // in "Local Town" (nearby towns), not "Local"
    await runAddressChecks({ fetcher: f, now: at(300), send });
    await runAddressChecks({ fetcher: f, now: at(360), send });
    expect(sent).toHaveLength(3);
    expect(sent[2].body).toMatch(/^Hup Up order problem: Address is in nearby towns zone, customer paid for Kiryas Joel\. Order /);
    const { addressMarks } = await import("@/lib/address-checks");
    expect((await addressMarks([orderId])).get(orderId)).toBe("Address is in nearby towns zone, customer paid for Kiryas Joel");
    const [ord] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
    expect(ord.status).toBe("CONFIRMED");
    expect(ord.deliveryFeeCents).toBe(1000);
  });
  it("confirmed in the zone paid for: the mark clears quietly (no text)", async () => {
    const { f } = services("fail", "ok", "fail", [-74.16, 41.34]); // inside "Local"
    await runAddressChecks({ fetcher: f, now: at(420), send });
    expect(sent).toHaveLength(3);
    const { addressMarks } = await import("@/lib/address-checks");
    expect((await addressMarks([orderId])).size).toBe(0);
    const [ord] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
    expect(ord.addressSource).toBe("census");
  });
  it("no staff texts during Shabbes: held, then sent right after", async () => {
    const [o] = await db
      .insert(schema.orders)
      .values({ status: "CONFIRMED", channel: "PHONE", eventDate: "2026-11-23", pickupDate: "2026-11-24", deliveryAddress: "9 Unknown Lane, Monroe, NY 10950", deliveryZone: "Nearby towns", deliveryFeeCents: 1500 })
      .returning();
    const fri = new Date("2026-11-20T22:00:00Z"); // Friday 5 PM in New York, after candle lighting
    await noteAddressCheck(o.id, fri);
    const { f } = services("none", "none", "none");
    await runAddressChecks({ fetcher: f, now: new Date(fri.getTime() + 15 * 60_000), send });
    expect(sent).toHaveLength(3);
    const [row] = await db.select().from(schema.addressChecks).where(eq(schema.addressChecks.orderId, o.id));
    expect(row.alerts.filter((a) => !a.sentAt)).toHaveLength(1);
    await runAddressChecks({ fetcher: f, now: new Date("2026-11-22T00:30:00Z"), send }); // Saturday night, after Shabbes
    expect(sent).toHaveLength(4);
    expect(sent[3].body).toMatch(/Address does not exist/);
  });
  it("stops once the order is cancelled or delivered", async () => {
    const [o] = await db.insert(schema.orders).values({ status: "CONFIRMED", channel: "PHONE", eventDate: "2026-11-25", pickupDate: "2026-11-26", deliveryAddress: "7 Unknown Lane, Monroe, NY 10950", deliveryZone: "Nearby towns", deliveryFeeCents: 1500 }).returning();
    await noteAddressCheck(o.id, at(0));
    await db.update(schema.orders).set({ status: "CANCELLED" }).where(eq(schema.orders.id, o.id));
    const { f } = services("fail", "fail", "fail");
    await runAddressChecks({ fetcher: f, now: at(600), send });
    const [row] = await db.select().from(schema.addressChecks).where(eq(schema.addressChecks.orderId, o.id));
    expect(row.status).toBe("stopped");
  });
});
