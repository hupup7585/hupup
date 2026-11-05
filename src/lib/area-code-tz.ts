/**
 * Recipient local time for promotional quiet hours (8:00 AM - 9:00 PM).
 *
 * The area code of a +1 (North American) number is mapped to the time zone(s) it covers. When an area
 * code spans two zones, every zone is returned and a promotional text may go out only when it is within
 * the window in ALL of them. Unknown area codes, toll-free numbers and non +1 numbers fall back to
 * New York time (the business's zone).
 *
 * Limitation: a mobile number keeps its area code when the person moves, so this is the industry-standard
 * approximation of "the recipient's local time", not a location lookup.
 */

export const FALLBACK_TIME_ZONE = "America/New_York";

const ET = "America/New_York";
const CT = "America/Chicago";
const MT = "America/Denver";
const PT = "America/Los_Angeles";
const AZ = "America/Phoenix"; // no daylight saving
const AK = "America/Anchorage";
const HI = "Pacific/Honolulu";
const AT = "America/Halifax";
const NT = "America/St_Johns";
const SK = "America/Regina"; // no daylight saving

/** Area codes grouped by zone; a code listed under two zones spans both. */
const GROUPS: [string[], string[]][] = [
  [
    [ET],
    [
      // New York
      "212", "315", "329", "332", "347", "363", "516", "518", "585", "607", "624", "631", "646", "680", "716", "718", "838", "845", "914", "917", "929", "934",
      // Connecticut, Delaware, DC, Maine, Maryland, Massachusetts, New Hampshire, Rhode Island, Vermont
      "203", "475", "860", "959", "302", "202", "771", "207", "227", "240", "301", "410", "443", "667", "339", "351", "413", "508", "617", "774", "781", "857", "978", "603", "401", "802",
      // New Jersey, Pennsylvania
      "201", "551", "609", "640", "732", "848", "856", "862", "908", "973", "215", "223", "267", "272", "412", "445", "484", "570", "582", "610", "717", "724", "814", "835", "878",
      // Ohio, West Virginia, Virginia
      "216", "220", "234", "283", "326", "330", "380", "419", "436", "440", "513", "567", "614", "740", "937", "304", "681", "276", "434", "540", "571", "686", "703", "757", "804", "826", "948",
      // North Carolina, South Carolina, Georgia
      "252", "336", "472", "704", "743", "828", "910", "919", "980", "984", "803", "821", "839", "843", "854", "864", "229", "404", "470", "478", "678", "706", "762", "770", "912", "943",
      // Florida (except the panhandle)
      "239", "305", "321", "352", "386", "407", "561", "645", "656", "689", "727", "754", "772", "786", "813", "863", "904", "941", "954",
      // Michigan (except 906), Indiana (eastern), Kentucky (eastern), Tennessee (eastern)
      "231", "248", "269", "313", "517", "586", "616", "679", "734", "810", "947", "989", "260", "317", "463", "574", "765", "930", "502", "606", "859", "423", "865",
      // Ontario, Quebec
      "226", "249", "289", "343", "365", "382", "416", "437", "519", "548", "613", "647", "683", "705", "742", "753", "905", "942", "263", "354", "367", "418", "438", "450", "468", "514", "579", "581", "819", "873",
    ],
  ],
  [
    [CT],
    [
      "205", "251", "256", "334", "659", "938", // Alabama
      "327", "479", "501", "870", // Arkansas
      "217", "224", "309", "312", "331", "447", "464", "618", "630", "708", "730", "773", "779", "815", "847", "872", // Illinois
      "319", "515", "563", "641", "712", // Iowa
      "225", "318", "337", "504", "985", // Louisiana
      "218", "320", "507", "612", "651", "763", "952", // Minnesota
      "228", "601", "662", "769", // Mississippi
      "314", "417", "557", "573", "636", "660", "816", "975", // Missouri
      "405", "539", "572", "580", "918", // Oklahoma
      "262", "274", "353", "414", "534", "608", "715", "920", // Wisconsin
      "316", "913", "402", "531", // Kansas (east), Nebraska (east)
      "615", "629", "731", "901", // Tennessee (middle/west)
      "210", "214", "254", "281", "325", "346", "361", "409", "430", "469", "512", "682", "713", "726", "737", "806", "817", "830", "832", "903", "936", "940", "945", "956", "972", "979", // Texas
      "204", "431", "584", // Manitoba
    ],
  ],
  [[MT], ["303", "719", "720", "970", "983", "406", "505", "575", "385", "435", "801", "307", "915", "368", "403", "587", "780", "825"]], // CO, MT, NM, UT, WY, El Paso TX, Alberta
  [[AZ], ["480", "520", "602", "623"]],
  [[PT], ["209", "213", "279", "310", "323", "341", "350", "369", "408", "415", "424", "442", "510", "530", "559", "562", "619", "626", "628", "650", "657", "661", "669", "707", "714", "747", "760", "805", "818", "820", "831", "840", "858", "909", "916", "925", "949", "951", "206", "253", "360", "425", "509", "564", "503", "971", "702", "725", "236", "604", "672", "778"]], // CA, WA, OR, NV, BC
  [[AK], ["907"]],
  [[HI], ["808"]],
  [[AT], ["428", "506", "782", "902"]], // New Brunswick, Nova Scotia, PEI
  [[NT], ["709"]], // Newfoundland
  [[SK], ["306", "474", "639"]], // Saskatchewan
  [["America/Puerto_Rico"], ["787", "939"]],
  [["America/St_Thomas"], ["340"]],
  [["Pacific/Guam"], ["671"]],
  [["Pacific/Saipan"], ["670"]],
  [["Pacific/Pago_Pago"], ["684"]],
  // Area codes that span two zones: both must be inside the window.
  [[ET, CT], ["850", "448", "906", "219", "812", "270", "364", "931", "807"]], // FL panhandle, MI UP, IN, KY, TN, NW Ontario
  [[CT, MT], ["620", "785", "308", "605", "701", "432"]], // KS west, NE west, SD, ND, far west TX
  [[MT, PT], ["208", "986", "458", "541", "775", "250"]], // ID, eastern OR, NV (West Wendover), BC interior
  [[AZ, MT], ["928"]], // Navajo Nation observes daylight saving
  [["America/Whitehorse", "America/Yellowknife", "America/Iqaluit"], ["867"]], // Canadian territories
];

const TABLE: Map<string, string[]> = (() => {
  const m = new Map<string, string[]>();
  for (const [zones, codes] of GROUPS) for (const c of codes) m.set(c, zones);
  return m;
})();

const TOLL_FREE = new Set(["800", "833", "844", "855", "866", "877", "888"]);

/** Time zone(s) for a phone number's area code; New York when unknown. */
export function timeZonesForPhone(phone: string | null | undefined): { zones: string[]; source: "area_code" | "fallback" } {
  const digits = (phone ?? "").replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits.length === 10 ? digits : null;
  const area = national?.slice(0, 3);
  const zones = area && !TOLL_FREE.has(area) ? TABLE.get(area) : undefined;
  return zones ? { zones, source: "area_code" } : { zones: [FALLBACK_TIME_ZONE], source: "fallback" };
}

export const PROMO_HOURS = { start: 8, end: 21 } as const;

function hourIn(zone: string, now: Date): number {
  return Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: zone }).format(now));
}

/** True when it is 8:00 AM - 8:59 PM in every time zone the recipient's area code may be in. */
export function inRecipientPromoHours(phone: string | null | undefined, now = new Date()): boolean {
  return timeZonesForPhone(phone).zones.every((z) => {
    const h = hourIn(z, now);
    return h >= PROMO_HOURS.start && h < PROMO_HOURS.end;
  });
}

/** Area codes in the table (for tests). */
export function knownAreaCodes(): string[] {
  return [...TABLE.keys()];
}
