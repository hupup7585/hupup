/**
 * Driver navigation links for the Delivery screen. Free links only: Google Maps "Maps URLs" and Waze deep links.
 * No API key, no account, nothing billed. Stops stay in the order the Delivery screen shows them (no automatic
 * route ordering; that would need a paid Google API and is not turned on).
 *
 * - Google Maps directions link: origin, destination and up to 9 stops in between. With no origin, Google starts
 *   from the phone's current location. Longer runs are split into parts (each part starts where the last ended).
 * - Waze link: a destination only. Waze always starts from where the phone is, so it is used for "go to the next
 *   stop" from the stop the driver is at.
 */

export const GOOGLE_MAX_WAYPOINTS = 9;

export type RouteStop = {
  /** Unique per stop, e.g. "12-delivery" */
  key: string;
  address: string | null;
  /** "Delivery · Yossi Friedman" */
  label: string;
  done: boolean;
};

export type RouteLink = { label: string; url: string };
export type NextLeg = { label: string; address: string; toStock: boolean; google: string; waze: string };

const clean = (a: string | null | undefined) => (a ?? "").replace(/\s+/g, " ").trim();

/** Google Maps driving directions. origin null = from the phone's current location. */
export function googleDirections(origin: string | null, destination: string, waypoints: string[] = []): string {
  const p = new URLSearchParams({ api: "1" });
  if (origin) p.set("origin", origin);
  p.set("destination", destination);
  if (waypoints.length) p.set("waypoints", waypoints.join("|"));
  p.set("travelmode", "driving");
  return `https://www.google.com/maps/dir/?${p.toString()}`;
}

/** Waze: drive from here to this address. */
export function wazeTo(address: string): string {
  return `https://waze.com/ul?q=${encodeURIComponent(address)}&navigate=yes`;
}

/** Drop a stop that is at the same address as the one right before it (e.g. a pickup and a drop-off at one house). */
function dedupeConsecutive(points: string[]): string[] {
  return points.filter((p, i) => i === 0 || p.toLowerCase() !== points[i - 1].toLowerCase());
}

/**
 * Google Maps links for a run of addresses, split into parts when there are more stops than one link can hold.
 * fromHere: the first part starts from the phone's location; otherwise from points[0].
 */
export function googleRunLinks(pointsIn: string[], fromHere: boolean, label: string): RouteLink[] {
  const points = dedupeConsecutive(pointsIn.map(clean).filter(Boolean));
  let origin: string | null = fromHere ? null : (points.shift() ?? null);
  if (!points.length) return [];
  const parts: string[][] = [];
  while (points.length) parts.push(points.splice(0, GOOGLE_MAX_WAYPOINTS + 1));
  return parts.map((part, i) => {
    const url = googleDirections(origin, part[part.length - 1], part.slice(0, -1));
    origin = part[part.length - 1];
    return { label: parts.length > 1 ? `${label} (part ${i + 1} of ${parts.length})` : label, url };
  });
}

/** Stops that can be driven to (have an address). */
export const routable = (stops: RouteStop[]) => stops.filter((s) => clean(s.address));

/**
 * Where to drive after stop i: the next stop in the list that still needs doing and has an address,
 * or back to stock when none are left. Null when there is nowhere to go (no next stop and no stock address).
 */
export function nextLeg(stops: RouteStop[], i: number, stockAddress: string | null): NextLeg | null {
  const from = clean(stops[i]?.address) || null;
  const next = stops.slice(i + 1).find((s) => !s.done && clean(s.address));
  const stock = clean(stockAddress);
  const target = next ? { label: next.label, address: clean(next.address), toStock: false } : stock ? { label: "Back to stock", address: stock, toStock: true } : null;
  if (!target) return null;
  return { ...target, google: googleDirections(from, target.address), waze: wazeTo(target.address) };
}

/** The first stop still to do (for "start the run" from wherever the driver is). */
export function firstLeg(stops: RouteStop[]): NextLeg | null {
  const s = stops.find((x) => !x.done && clean(x.address));
  if (!s) return null;
  const a = clean(s.address);
  return { label: s.label, address: a, toStock: false, google: googleDirections(null, a), waze: wazeTo(a) };
}

/**
 * Whole-day links: stock → every stop in order → stock (or from the phone's location when no stock address is set),
 * plus "remaining stops" from here once some stops are done.
 */
export function dayRunLinks(stops: RouteStop[], stockAddress: string | null): { whole: RouteLink[]; remaining: RouteLink[] } {
  const stock = clean(stockAddress);
  const all = routable(stops).map((s) => clean(s.address));
  const left = routable(stops.filter((s) => !s.done)).map((s) => clean(s.address));
  const withStock = (pts: string[]) => (stock ? [...pts, stock] : pts);
  const whole = all.length ? googleRunLinks(stock ? [stock, ...withStock(all)] : all, !stock, "Whole day in Google Maps") : [];
  const someDone = stops.some((s) => s.done);
  const remaining = someDone && left.length ? googleRunLinks(withStock(left), true, "Remaining stops in Google Maps") : [];
  return { whole, remaining };
}
