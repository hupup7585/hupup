/**
 * Orange County, New York zip codes and the town the phone reads back (Abraham, Nov 17, 2026: the system fills the
 * town from the zip). A zip that is not here is outside Orange County: "We are sorry, we do not serve this area."
 * 10950 covers both Kiryas Joel and Monroe; the street (the delivery map) decides the price.
 */
export const ORANGE_COUNTY_ZIPS: Record<string, string> = {
  "10910": "Arden",
  "10912": "Bellvale",
  "10914": "Blooming Grove",
  "10915": "Bullville",
  "10916": "Campbell Hall",
  "10917": "Central Valley",
  "10918": "Chester",
  "10919": "Circleville",
  "10921": "Florida",
  "10922": "Fort Montgomery",
  "10924": "Goshen",
  "10925": "Greenwood Lake",
  "10926": "Harriman",
  "10928": "Highland Falls",
  "10930": "Highland Mills",
  "10932": "Howells",
  "10933": "Johnson",
  "10940": "Middletown",
  "10941": "Middletown",
  "10949": "Monroe",
  "10950": "Monroe",
  "10953": "Mountainville",
  "10958": "New Hampton",
  "10959": "New Milford",
  "10963": "Otisville",
  "10969": "Pine Island",
  "10973": "Slate Hill",
  "10975": "Southfields",
  "10979": "Sterling Forest",
  "10981": "Sugar Loaf",
  "10985": "Thompson Ridge",
  "10987": "Tuxedo Park",
  "10988": "Unionville",
  "10990": "Warwick",
  "10992": "Washingtonville",
  "10996": "West Point",
  "10997": "West Point",
  "10998": "Westtown",
  "12518": "Cornwall",
  "12520": "Cornwall on Hudson",
  "12543": "Maybrook",
  "12549": "Montgomery",
  "12550": "Newburgh",
  "12551": "Newburgh",
  "12552": "Newburgh",
  "12553": "New Windsor",
  "12555": "Newburgh",
  "12566": "Pine Bush",
  "12575": "Rock Tavern",
  "12577": "Salisbury Mills",
  "12584": "Vails Gate",
  "12586": "Walden",
  "12729": "Cuddebackville",
  "12746": "Huguenot",
  "12771": "Port Jervis",
  "12780": "Sparrow Bush",
};

export const DEFAULT_ZIP = "10950";

export function townForZip(zip: string): string | null {
  return ORANGE_COUNTY_ZIPS[zip] ?? null;
}
