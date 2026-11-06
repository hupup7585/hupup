/**
 * Sunrise, sunset, chatzos and tzeis, written in-house from the NOAA solar equations (public domain; after Jean
 * Meeus, "Astronomical Algorithms"). Sea level, no elevation, like the business has always used.
 *
 * - Sunrise / sunset: the sun's upper edge on the horizon (zenith 90.833 deg: 34' refraction + 16' solar radius).
 * - Chatzos: halfway between sunrise and sunset.
 * - Tzeis: the sun 8.5 deg below the horizon after sunset.
 */
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Julian centuries since J2000.0 for a Julian Day. */
const centuries = (jd: number) => (jd - 2451545.0) / 36525.0;

function sun(t: number) {
  const L0 = (280.46646 + t * (36000.76983 + 0.0003032 * t)) % 360; // geometric mean longitude
  const M = 357.52911 + t * (35999.05029 - 0.0001537 * t); // mean anomaly
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t); // orbit eccentricity
  const C = Math.sin(rad(M)) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(rad(2 * M)) * (0.019993 - 0.000101 * t) + Math.sin(rad(3 * M)) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * t;
  const appLong = trueLong - 0.00569 - 0.00478 * Math.sin(rad(omega));
  const meanObliq = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliq = meanObliq + 0.00256 * Math.cos(rad(omega));
  const declination = deg(Math.asin(Math.sin(rad(obliq)) * Math.sin(rad(appLong))));
  const y = Math.tan(rad(obliq / 2)) ** 2;
  const eqTime =
    4 *
    deg(
      y * Math.sin(2 * rad(L0)) -
        2 * e * Math.sin(rad(M)) +
        4 * e * y * Math.sin(rad(M)) * Math.cos(2 * rad(L0)) -
        0.5 * y * y * Math.sin(4 * rad(L0)) -
        1.25 * e * e * Math.sin(2 * rad(M)),
    ); // minutes
  return { declination, eqTime };
}

/** Julian Day at 0h UTC of a Gregorian date. */
function julianDay(y: number, m: number, d: number) {
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const A = Math.floor(y / 100);
  const B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5;
}

/**
 * UTC minutes after 0h of the date when the sun crosses `zenith` (rising or setting), or NaN if it never does.
 * Longitude is east-positive (Kiryas Joel is about -74.17).
 */
function crossing(jd: number, lat: number, lon: number, zenith: number, rising: boolean): number {
  let minutes = 720 - 4 * lon; // first guess: local solar noon
  for (let i = 0; i < 4; i++) {
    const { declination, eqTime } = sun(centuries(jd + minutes / 1440));
    const cosH = (Math.cos(rad(zenith)) - Math.sin(rad(lat)) * Math.sin(rad(declination))) / (Math.cos(rad(lat)) * Math.cos(rad(declination)));
    if (cosH > 1 || cosH < -1) return NaN;
    const H = deg(Math.acos(cosH));
    minutes = 720 - 4 * (lon + (rising ? H : -H)) - eqTime;
  }
  return minutes;
}

export type Place = { latitude: number; longitude: number };

const SUNRISE_SUNSET_ZENITH = 90 + 50 / 60;

/** All times for one civil date ("YYYY-MM-DD" in the place's own calendar). */
export function zmanim(iso: string, place: Place) {
  const [y, m, d] = iso.split("-").map(Number);
  const jd = julianDay(y, m, d);
  const base = Date.UTC(y, m - 1, d);
  const at = (min: number) => new Date(base + Math.round(min * 60_000));
  const rise = crossing(jd, place.latitude, place.longitude, SUNRISE_SUNSET_ZENITH, true);
  const set = crossing(jd, place.latitude, place.longitude, SUNRISE_SUNSET_ZENITH, false);
  return {
    sunrise: () => at(rise),
    sunset: () => at(set),
    chatzos: () => at((rise + set) / 2),
    tzeis: (angle = 8.5) => at(crossing(jd, place.latitude, place.longitude, 90 + angle, false)),
  };
}
