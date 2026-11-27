/**
 * Item types (Admin handoff Phase 4, Nov 27, 2026). Until now the system worked out what an item is from words in its
 * name ("laser", "maze", "paddle", "ocean", "6", "four" ...), in 26 places. The Owner can now set it explicitly on
 * Catalog > Item types; the choice is kept in the setting "itemTypes" (no database change). Anything not set is still
 * worked out from the name exactly as before, so nothing changes until the Owner sets a type.
 */

export const CATEGORY_KINDS = ["laser_tag", "laser_addons", "paddle_boat", "ocean_balls", "jumping_balloon", "other"] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];
export const CATEGORY_KIND_LABEL: Record<CategoryKind, string> = {
  laser_tag: "Laser tag (mazes and gun sets)",
  laser_addons: "Laser tag add-on packs (only with a maze)",
  paddle_boat: "Paddle boats",
  ocean_balls: "Ocean balls (offered with a jumping balloon)",
  jumping_balloon: "Jumping balloons and other inflatables",
  other: "Other",
};

export const LASER_ROLES = ["maze_six", "maze_four", "maze", "six_guns", "four_guns", "none"] as const;
export type LaserRole = (typeof LASER_ROLES)[number];
export const LASER_ROLE_LABEL: Record<LaserRole, string> = {
  maze_six: "Maze with 6 laser guns",
  maze_four: "Maze with 4 laser guns",
  maze: "Maze (no guns counted)",
  six_guns: "6 laser guns (no maze)",
  four_guns: "4 laser guns (no maze)",
  none: "Not a laser tag set",
};

export type ItemTypes = { categories: Record<string, CategoryKind>; products: Record<string, LaserRole> };

/** The Owner's explicit types from the setting (empty when none are set or the value is unreadable). */
export function parseItemTypes(raw: unknown): ItemTypes {
  try {
    const v = typeof raw === "string" ? (raw.trim() ? JSON.parse(raw) : {}) : raw ?? {};
    const cats = Object.fromEntries(Object.entries((v as ItemTypes).categories ?? {}).filter(([, k]) => (CATEGORY_KINDS as readonly string[]).includes(k)));
    const prods = Object.fromEntries(Object.entries((v as ItemTypes).products ?? {}).filter(([, k]) => (LASER_ROLES as readonly string[]).includes(k)));
    return { categories: cats as ItemTypes["categories"], products: prods as ItemTypes["products"] };
  } catch {
    return { categories: {}, products: {} };
  }
}

/** Worked out from the category name, the way the system did before Phase 4. */
export function guessCategoryKind(name: string): CategoryKind {
  const n = name.trim();
  if (/^laser tag add-ons$/i.test(n)) return "laser_addons"; // the exact name the phone and New booking used
  if (/laser/i.test(n)) return "laser_tag";
  if (/paddle|boat/i.test(n)) return "paddle_boat";
  if (/ocean/i.test(n)) return "ocean_balls";
  if (/balloon|bounce|jump|inflatable|castle/i.test(n)) return "jumping_balloon";
  return "other";
}

/** Worked out from the item name (laser tag only), the way the laser gun pools did before Phase 4. */
export function guessLaserRole(productName: string, kind: CategoryKind): LaserRole {
  if (kind !== "laser_tag" && kind !== "laser_addons") return "none";
  const maze = /maze/i.test(productName);
  const six = /(^|\D)6(\D|$)|\bsix\b/i.test(productName);
  const four = !six && /(^|\D)4(\D|$)|\bfour\b/i.test(productName);
  if (maze) return six ? "maze_six" : four ? "maze_four" : "maze";
  return six ? "six_guns" : four ? "four_guns" : "none";
}

/** A category's kind: the Owner's choice, else worked out from its name. */
export function categoryKind(cat: { id: number; name: string }, types: ItemTypes): CategoryKind {
  return types.categories[String(cat.id)] ?? guessCategoryKind(cat.name);
}

/** A laser item's role: the Owner's choice, else worked out from its name. */
export function laserRole(p: { id: number; name: string }, kind: CategoryKind, types: ItemTypes): LaserRole {
  return types.products[String(p.id)] ?? guessLaserRole(p.name, kind);
}

export const isMazeRole = (r: LaserRole) => r === "maze_six" || r === "maze_four" || r === "maze";

/** The saved setting value for a form's choices: only the ones that differ from what the name already gives. */
export function itemTypesToSave(
  categories: { id: number; name: string }[],
  products: { id: number; name: string; categoryId: number }[],
  chosenCats: Record<string, string>,
  chosenProds: Record<string, string>,
): ItemTypes {
  const out: ItemTypes = { categories: {}, products: {} };
  const kindOf = new Map<number, CategoryKind>();
  for (const c of categories) {
    const pick = chosenCats[String(c.id)];
    const k = (CATEGORY_KINDS as readonly string[]).includes(pick) ? (pick as CategoryKind) : guessCategoryKind(c.name);
    if (k !== guessCategoryKind(c.name)) out.categories[String(c.id)] = k;
    kindOf.set(c.id, k);
  }
  for (const p of products) {
    const kind = kindOf.get(p.categoryId) ?? "other";
    const pick = chosenProds[String(p.id)];
    if (!(LASER_ROLES as readonly string[]).includes(pick)) continue;
    if (pick !== guessLaserRole(p.name, kind)) out.products[String(p.id)] = pick as LaserRole;
  }
  return out;
}
