import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";

/**
 * Delivery fees by map area (Abraham, Nov 15, 2026). The source is his Google My Maps "Price list"; the live site
 * downloads its shapes (KML) during each live build and when the Owner presses "Reload the map" in Admin. The Owner
 * can rename each area and change its price; a reload keeps those edits. An address is placed on the map with the
 * free US Census address service (OpenStreetMap as a backup); no key and no cost. The house decides the price, never
 * the street, and nobody changes it by hand (prices: RULE_CENTS). Not found = the address is asked for again.
 */
export const DELIVERY_MAP_KML = "https://www.google.com/maps/d/kml?mid=1Wuj9Q746oXbWSeTPs0nO7yVpJ0En6N8&forcekml=1";

export type Ring = [number, number][]; // [longitude, latitude]
export type DeliveryArea = { id: string; mapName: string; name: string; priceCents: number | null; polygons: Ring[] };

const text = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();

/** Areas from the map file: every placemark with a shape (names only; prices follow the rule). */
export function parseKml(kml: string): DeliveryArea[] {
  const out: DeliveryArea[] = [];
  const folders = [...kml.matchAll(/<Folder>([\s\S]*?)<\/Folder>/g)].map((m) => m[1]);
  const chunks = folders.length ? folders : [kml];
  for (const chunk of chunks) {
    for (const pm of chunk.matchAll(/<Placemark>([\s\S]*?)<\/Placemark>/g)) {
      const body = pm[1];
      const polys = [...body.matchAll(/<outerBoundaryIs>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/g)].map((c) =>
        c[1]
          .trim()
          .split(/\s+/)
          .map((p) => p.split(",").map(Number))
          .filter((p) => p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
          .map((p) => [p[0], p[1]] as [number, number]),
      );
      if (!polys.length || polys.every((r) => r.length < 3)) continue;
      const mapName = text(/<name>([\s\S]*?)<\/name>/.exec(body)?.[1] ?? "Area");
      const plain = mapName.replace(/\$\s*\d+(?:\.\d{1,2})?/g, "").replace(/^[\s:,-]+|[\s:,-]+$/g, "") || mapName;
      // The price comes from Abraham's rule (RULE_CENTS), never from the map's labels; shown here for Admin only
      const area = { id: `${mapName}#${out.filter((a) => a.mapName === mapName).length}`, mapName, name: plain, priceCents: 0, polygons: polys.filter((r) => r.length >= 3) };
      out.push({ ...area, priceCents: /^\s*local\s*$/i.test(plain) ? 1000 : 1500 });
    }
  }
  return out;
}

export function inRing([x, y]: [number, number], ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const ringArea = (r: Ring) => Math.abs(r.reduce((s, [x, y], i) => s + x * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * y, 0) / 2);

/** Distance in meters from a point to a shape's edge (good enough at this size). */
function metersToEdge([x, y]: [number, number], ring: Ring): number {
  const kx = 111_320 * Math.cos((y * Math.PI) / 180);
  const ky = 110_540;
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = (ring[j][0] - x) * kx, ay = (ring[j][1] - y) * ky, bx = (ring[i][0] - x) * kx, by = (ring[i][1] - y) * ky;
    const dx = bx - ax, dy = by - ay;
    const t = dx || dy ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy))) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}
/** A house this close to a zone line counts as on the line. */
export const ON_LINE_METERS = 10;

/** Is this the KJ line (the map's "Local" shape)? */
export const isLocalArea = (a: DeliveryArea) => /^\s*local\s*$/i.test(a.mapName.replace(/\$\s*\d+(\.\d+)?/g, "").replace(/[^a-z\s]/gi, " "));

/**
 * Delivery prices (Abraham, Nov 15, 2026), one rule, from the house's spot only (never the map's price labels):
 * inside the KJ line (Local) $10; inside any other colored area $15 (Chester and Ruach Hchaim too); outside every
 * colored area $20. A house on a zone line (within ON_LINE_METERS) gets the lower price.
 */
export const RULE_CENTS = { local: 1000, area: 1500, outside: 2000 } as const;

/** The Owner's zone prices (Admin, Delivery settings), with Abraham's rule as the default. */
export type ZonePrices = { deliveryFeeKjCents?: string; deliveryFeeAreaCents?: string; deliveryFeeOutsideCents?: string; deliveryPromoOn?: boolean | string; deliveryPromoStart?: string; deliveryPromoEnd?: string };
/** Free delivery promo prices (Abraham, Nov 17, 2026): KJ free, nearby towns $10; the $20 zone is unchanged. */
export const PROMO_CENTS = { local: 0, area: 1000 } as const;

const cents = (v: string | undefined, fallback: number) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : fallback);

/**
 * Is the free delivery promo on for this delivery? Counted by the delivery date (Abraham, Nov 17, 2026): on, and the
 * delivery date within the start and end dates (blank = open). A Date means that day in Eastern time.
 */
export function deliveryPromoActive(s: ZonePrices, when: Date | string = new Date()): boolean {
  if (!(s.deliveryPromoOn === true || s.deliveryPromoOn === "true")) return false;
  const today = typeof when === "string" ? when.slice(0, 10) : when.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  if (s.deliveryPromoStart && today < s.deliveryPromoStart) return false;
  if (s.deliveryPromoEnd && today > s.deliveryPromoEnd) return false;
  return true;
}

/** The delivery fee for a zone: the Owner's prices, or the promo price while the promo is on. */
export function zoneFee(kind: "local" | "area" | "outside", s: ZonePrices = {}, now: Date | string = new Date()): number {
  if (kind !== "outside" && deliveryPromoActive(s, now)) return PROMO_CENTS[kind];
  if (kind === "local") return cents(s.deliveryFeeKjCents, RULE_CENTS.local);
  if (kind === "area") return cents(s.deliveryFeeAreaCents, RULE_CENTS.area);
  return cents(s.deliveryFeeOutsideCents, RULE_CENTS.outside);
}

export const zoneKind = (a: DeliveryArea | null): "local" | "area" | "outside" => (!a ? "outside" : isLocalArea(a) ? "local" : "area");

/** The zones a house is in or on the line of. */
export function areasAt(lng: number, lat: number, areas: DeliveryArea[]): DeliveryArea[] {
  return areas.filter((a) => a.polygons.some((r) => inRing([lng, lat], r) || metersToEdge([lng, lat], r) <= ON_LINE_METERS));
}

/** The zone that sets the price: the KJ line wins when the house is in it or on its line. */
export function areaAt(lng: number, lat: number, areas: DeliveryArea[]): DeliveryArea | null {
  const hits = areasAt(lng, lat, areas);
  return hits.find(isLocalArea) ?? hits[0] ?? null;
}

export function priceFor(a: DeliveryArea | null, s: ZonePrices = {}, now: Date | string = new Date()): number {
  return zoneFee(zoneKind(a), s, now);
}

/** A point inside an area (for the build's one-address-per-area test). */
export function pointInside(a: DeliveryArea): [number, number] | null {
  const r = a.polygons.slice().sort((p, q) => ringArea(q) - ringArea(p))[0];
  if (!r) return null;
  const cx = r.reduce((s, p) => s + p[0], 0) / r.length;
  const cy = r.reduce((s, p) => s + p[1], 0) / r.length;
  if (inRing([cx, cy], r)) return [cx, cy];
  for (let k = 1; k < r.length - 1; k++) {
    const m: [number, number] = [(r[0][0] + r[k][0] + r[k + 1][0]) / 3, (r[0][1] + r[k][1] + r[k + 1][1]) / 3];
    if (inRing(m, r)) return m;
  }
  return null;
}

/* ---- Placing an address on the map ---- */

const normalizeAddress = (a: string) => a.trim().replace(/\s+/g, " ").toLowerCase();
/** Most callers say the street and town; New York is added when the address has no state. */
export const withState = (a: string) => (/\b(ny|new york)\b/i.test(a) ? a : `${a}, NY`);

export async function geocode(address: string, fetcher: typeof fetch = fetch): Promise<{ lng: number; lat: number; source: string } | null> {
  const key = normalizeAddress(address);
  const [hit] = await db.select().from(schema.geocodeCache).where(eq(schema.geocodeCache.address, key)).limit(1);
  if (hit) return hit.lat === null || hit.lng === null ? null : { lng: hit.lng, lat: hit.lat, source: hit.source };
  let found: { lng: number; lat: number; source: string } | null = null;
  try {
    const r = await fetcher(`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=${encodeURIComponent(withState(address))}`, { signal: AbortSignal.timeout(8000) });
    const j = (await r.json().catch(() => ({}))) as { result?: { addressMatches?: { coordinates?: { x: number; y: number } }[] } };
    const c = j.result?.addressMatches?.[0]?.coordinates;
    if (c) found = { lng: c.x, lat: c.y, source: "census" };
  } catch {
    /* try the backup */
  }
  if (!found) {
    try {
      const r = await fetcher(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(withState(address))}`, { headers: { "user-agent": "HupUpAttractionsBookings/1.0" }, signal: AbortSignal.timeout(8000) });
      const j = (await r.json().catch(() => [])) as { lat?: string; lon?: string }[];
      if (j[0]?.lat && j[0]?.lon) found = { lng: Number(j[0].lon), lat: Number(j[0].lat), source: "openstreetmap" };
    } catch {
      /* not found */
    }
  }
  await db
    .insert(schema.geocodeCache)
    .values({ address: key, lat: found?.lat ?? null, lng: found?.lng ?? null, source: found?.source ?? "none" })
    .onConflictDoNothing();
  return found;
}

/** Orange County, New York (Census county code). */
export const ORANGE_COUNTY_NY = "36071";
const countyCache = new Map<string, string | null>();

/**
 * Which county a spot is in, from the free US Census service (no key). Used only for houses outside every colored area:
 * those pay the "anywhere else in Orange County" price, and only inside Orange County, NY (Abraham, Nov 17, 2026).
 * Null when the service can't answer (then the house is not refused for that reason).
 */
export async function countyAt(lng: number, lat: number, fetcher: typeof fetch = fetch): Promise<string | null> {
  const k = `${lng.toFixed(5)},${lat.toFixed(5)}`;
  if (countyCache.has(k)) return countyCache.get(k) ?? null;
  let geoid: string | null = null;
  try {
    const r = await fetcher(`https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${lng}&y=${lat}&benchmark=Public_AR_Current&vintage=Current_Current&layers=Counties&format=json`, { signal: AbortSignal.timeout(8000) });
    const j = (await r.json().catch(() => ({}))) as { result?: { geographies?: { Counties?: { GEOID?: string }[] } } };
    geoid = j.result?.geographies?.Counties?.[0]?.GEOID ?? null;
  } catch {
    geoid = null;
  }
  if (geoid) countyCache.set(k, geoid);
  return geoid;
}

/* ---- Saved areas ---- */

export function savedAreas(json: string | null | undefined): DeliveryArea[] {
  try {
    const a = JSON.parse(json || "[]");
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

/** New shapes from the map, keeping the Owner's own names for areas already there (prices always follow the rule). */
export function mergeAreas(fromMap: DeliveryArea[], old: DeliveryArea[]): DeliveryArea[] {
  return fromMap.map((a) => {
    const before = old.find((o) => o.id === a.id);
    return before ? { ...a, name: before.name } : a;
  });
}

export async function reloadDeliveryMap(fetcher: typeof fetch = fetch): Promise<{ ok: boolean; message: string; areas?: DeliveryArea[] }> {
  const { getSettings, saveSetting } = await import("@/lib/settings");
  let kml = "";
  try {
    const r = await fetcher(DELIVERY_MAP_KML, { signal: AbortSignal.timeout(15000) });
    kml = r.ok ? await r.text() : "";
  } catch {
    kml = "";
  }
  const fromMap = parseKml(kml);
  if (!fromMap.length) return { ok: false, message: "The map could not be read. Check that it is still shared (anyone with the link can view), then try again." };
  const areas = mergeAreas(fromMap, savedAreas((await getSettings()).deliveryAreas));
  await saveSetting("deliveryAreas", JSON.stringify(areas), null);
  await saveSetting("deliveryAreasLoadedAt", new Date().toISOString(), null);
  return { ok: true, message: `Loaded ${areas.length} areas from your map.`, areas };
}

/* ---- The quote ---- */

/* ---- The street list (Hark, Nov 15, 2026): only to check spelling, never to set a price ---- */

const SUFFIX: Record<string, string> = { rd: "road", dr: "drive", st: "street", ct: "court", blvd: "boulevard", ln: "lane", pl: "place", pkwy: "parkway", ave: "avenue", av: "avenue", tpke: "turnpike", rte: "route", hwy: "highway", cir: "circle", ter: "terrace", e: "east", w: "west", n: "north", s: "south" };
/** "12 Forest Rd., Apt 3, Monroe" -> "forest road" */
export function streetOf(address: string): string {
  const first = address.split(",")[0] ?? "";
  return first
    .toLowerCase()
    .replace(/\b(apt|apartment|unit|suite|ste|#)\s*\S+/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/^\s*\d+[a-z]?\s+/, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => SUFFIX[w] ?? w)
    .join(" ");
}
function editDistance(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
/** A street on the list that looks like what was typed ("Karlsberg Rd" -> "Karlsburg Road"), or null. */
export function spellingHint(address: string, list: string): string | null {
  const typed = streetOf(address);
  if (!typed) return null;
  const names = list.split("\n").map((x) => x.trim()).filter(Boolean);
  if (names.some((n) => streetOf(`0 ${n}`) === typed)) return null;
  let best: { n: string; d: number } | null = null;
  for (const n of names) {
    const d = editDistance(typed, streetOf(`0 ${n}`));
    if (!best || d < best.d) best = { n, d };
  }
  return best && best.d <= Math.max(2, Math.floor(typed.length / 5)) ? best.n : null;
}

export type DeliveryQuote = { ok: true; zone: string; feeCents: number; kind?: "local" | "area" | "outside" } | { ok: false; reason: "no_address" | "not_found" | "outside" | "no_price"; area?: string };

/**
 * The delivery fee for an address: the price of the map area it is in. Before the map is loaded, the older town-name
 * rule is used. No price is ever guessed: outside every area, a place the map service can't find, or an area with
 * not found = the address is asked for again.
 */
export async function deliveryQuote(address: string | null | undefined, s: ZonePrices & { deliveryAreas: string; zoneKjPlaces: string; zoneAreaPlaces: string; deliveryFeeKjCents: string; deliveryFeeAreaCents: string; localStreets?: string }, fetcher: typeof fetch = fetch, now: Date | string = new Date()): Promise<DeliveryQuote> {
  if (!address?.trim()) return { ok: false, reason: "no_address" };
  const areas = savedAreas(s.deliveryAreas);
  if (!areas.length) {
    const { deliveryZone } = await import("@/lib/pricing");
    const z = deliveryZone(address, s);
    return z === "outside" ? { ok: false, reason: "outside" } : { ok: true, zone: z, feeCents: zoneFee(z === "kj" ? "local" : "area", s, now), kind: z === "kj" ? "local" : "area" };
  }
  // The house decides (Abraham, Nov 15, 2026): its spot on the map, from the free US Census address service
  const at = await geocode(address, fetcher);
  if (!at) return { ok: false, reason: "not_found" };
  const a = areaAt(at.lng, at.lat, areas);
  // Outside every colored area: Orange County, NY only (Abraham, Nov 17, 2026)
  if (!a) {
    const county = await countyAt(at.lng, at.lat, fetcher);
    if (county && county !== ORANGE_COUNTY_NY) return { ok: false, reason: "outside" };
  }
  return { ok: true, zone: a ? a.name : "Anywhere else in Orange County", feeCents: priceFor(a, s, now), kind: zoneKind(a) };
}

export const QUOTE_WHY: Record<string, string> = {
  no_address: "there is no delivery address",
  not_found: "the address could not be found on the map: check the spelling of the house number, street, town and ZIP",
  outside: "the house is outside the delivery area (Orange County, NY only)",
  no_price: "its area has no price yet",
};
