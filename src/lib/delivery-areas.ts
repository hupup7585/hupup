import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";

/**
 * Delivery fees by map area (Abraham, Nov 15, 2026). The source is his Google My Maps "Price list"; the live site
 * downloads its shapes (KML) during each live build and when the Owner presses "Reload the map" in Admin. The Owner
 * can rename each area and change its price; a reload keeps those edits. An address is placed on the map with the
 * free US Census address service (OpenStreetMap as a backup); no key and no cost. The house decides the price, never
 * the street, and nobody changes it by hand. Outside every zone = we don\u2019t deliver there; not found = the
 * address is asked for again.
 */
export const DELIVERY_MAP_KML = "https://www.google.com/maps/d/kml?mid=1Wuj9Q746oXbWSeTPs0nO7yVpJ0En6N8&forcekml=1";

export type Ring = [number, number][]; // [longitude, latitude]
export type DeliveryArea = { id: string; mapName: string; name: string; priceCents: number | null; polygons: Ring[] };

/** Abraham's prices (Nov 15, 2026), used for an area the first time it comes from the map. Chester is $15. */
const ABRAHAM_PRICES: [RegExp, number][] = [
  [/ruach/i, 2000],
  [/local town|woodbury junction|winchester|high st|highland lake|country hollow|blooming grove|chester/i, 1500],
  [/^\s*\$?\s*\d*\s*local\s*$|^local\b/i, 1000],
];

const text = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
const priceIn = (s: string): number | null => {
  const m = /\$\s*(\d+(?:\.\d{1,2})?)/.exec(s);
  return m ? Math.round(Number(m[1]) * 100) : null;
};

/** Areas from the map file: every placemark with a shape. A price in its name, notes or layer name is read too. */
export function parseKml(kml: string): DeliveryArea[] {
  const out: DeliveryArea[] = [];
  const folders = [...kml.matchAll(/<Folder>([\s\S]*?)<\/Folder>/g)].map((m) => m[1]);
  const chunks = folders.length ? folders : [kml];
  for (const chunk of chunks) {
    const layer = text(/<name>([\s\S]*?)<\/name>/.exec(chunk.replace(/<Placemark>[\s\S]*?<\/Placemark>/g, ""))?.[1] ?? "");
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
      const desc = text(/<description>([\s\S]*?)<\/description>/.exec(body)?.[1] ?? "");
      const plain = mapName.replace(/\$\s*\d+(?:\.\d{1,2})?/g, "").replace(/^[\s:,-]+|[\s:,-]+$/g, "") || mapName;
      const abraham = ABRAHAM_PRICES.find(([re]) => re.test(plain))?.[1] ?? null;
      out.push({ id: `${mapName}#${out.filter((a) => a.mapName === mapName).length}`, mapName, name: plain, priceCents: abraham ?? priceIn(mapName) ?? priceIn(desc) ?? priceIn(layer), polygons: polys.filter((r) => r.length >= 3) });
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

/**
 * The zone a house is in (Abraham, Nov 15, 2026: the house decides, not the street). On a zone line (or where two
 * zones overlap), the lower price wins.
 */
export function areaAt(lng: number, lat: number, areas: DeliveryArea[]): DeliveryArea | null {
  const hits = areas.filter((a) => a.polygons.some((r) => inRing([lng, lat], r) || metersToEdge([lng, lat], r) <= ON_LINE_METERS));
  if (!hits.length) return null;
  return hits.slice().sort((p, q) => (p.priceCents ?? Infinity) - (q.priceCents ?? Infinity))[0];
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

/* ---- Saved areas ---- */

export function savedAreas(json: string | null | undefined): DeliveryArea[] {
  try {
    const a = JSON.parse(json || "[]");
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

/** New shapes from the map, keeping the Owner's own names and prices for areas already there. */
export function mergeAreas(fromMap: DeliveryArea[], old: DeliveryArea[]): DeliveryArea[] {
  return fromMap.map((a) => {
    const before = old.find((o) => o.id === a.id);
    return before ? { ...a, name: before.name, priceCents: before.priceCents } : a;
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

export type DeliveryQuote = { ok: true; zone: string; feeCents: number } | { ok: false; reason: "no_address" | "not_found" | "outside" | "no_price"; area?: string };

/**
 * The delivery fee for an address: the price of the map area it is in. Before the map is loaded, the older town-name
 * rule is used. No price is ever guessed: outside every area, a place the map service can't find, or an area with
 * no price = the booking does not go on (outside: we don't deliver there; not found: the address is asked again).
 */
export async function deliveryQuote(address: string | null | undefined, s: { deliveryAreas: string; zoneKjPlaces: string; zoneAreaPlaces: string; deliveryFeeKjCents: string; deliveryFeeAreaCents: string; localStreets?: string }, fetcher: typeof fetch = fetch): Promise<DeliveryQuote> {
  if (!address?.trim()) return { ok: false, reason: "no_address" };
  const areas = savedAreas(s.deliveryAreas);
  if (!areas.length) {
    const { deliveryZone } = await import("@/lib/pricing");
    const z = deliveryZone(address, s);
    return z === "outside" ? { ok: false, reason: "outside" } : { ok: true, zone: z, feeCents: Number(z === "kj" ? s.deliveryFeeKjCents : s.deliveryFeeAreaCents) || 0 };
  }
  // The house decides (Abraham, Nov 15, 2026): its spot on the map, from the free US Census address service
  const at = await geocode(address, fetcher);
  if (!at) return { ok: false, reason: "not_found" };
  const a = areaAt(at.lng, at.lat, areas);
  if (!a) return { ok: false, reason: "outside" };
  if (a.priceCents === null) return { ok: false, reason: "no_price", area: a.name };
  return { ok: true, zone: a.name, feeCents: a.priceCents };
}

export const QUOTE_WHY: Record<string, string> = {
  no_address: "there is no delivery address",
  not_found: "the address could not be found on the map: check the spelling of the house number, street, town and ZIP",
  outside: "we don't deliver there (the house is outside every zone on the price map)",
  no_price: "its area has no price yet",
};
