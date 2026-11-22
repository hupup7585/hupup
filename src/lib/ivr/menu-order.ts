import type { PromptKey } from "@/lib/ivr/prompts";

/**
 * Menus made of several recordings (Hark for Abraham, Nov 19, 2026): each menu plays its recordings in a fixed order
 * the Owner sets in Admin (Phone, Menu order). The shared star line ("To go back, press star.") is one of them.
 * Stored in the setting `menuOrders` as JSON: { "book": ["book_r1", ...] }. A missing or bad value = the default.
 */
export const MENU_RECORDINGS = {
  book: { label: "Bookings menu (main menu key 1)", keys: ["book_r1", "book_orders_only", "book_r3a", "book_r2", "book_r3b", "book_back"] },
  balloons: { label: "Jumping balloons list", keys: ["balloons_open", "balloon_items", "cart_key", "book_back"] },
} as const satisfies Record<string, { label: string; keys: readonly string[] }>;

export type MenuId = keyof typeof MENU_RECORDINGS;
/** Recordings that play only the first time the caller reaches that menu (not when coming back to add more). */
export const FIRST_TIME_ONLY = new Set<string>(["book_orders_only"]);

/** "balloon_items" is the list of balloons itself (one entry per balloon), not a single recording. */
export type MenuPart = PromptKey | "balloon_items";

export function menuOrder(menu: MenuId, stored: string | null | undefined): MenuPart[] {
  const def = [...MENU_RECORDINGS[menu].keys] as MenuPart[];
  try {
    const all = JSON.parse(stored || "{}") as Record<string, unknown>;
    const got = all[menu];
    // Only a full reordering of the same recordings is used: nothing added, nothing left out
    if (Array.isArray(got) && got.length === def.length && def.every((k) => got.includes(k))) return got as MenuPart[];
  } catch {
    /* bad JSON: the default order */
  }
  return def;
}

export function setMenuOrder(menu: MenuId, order: string[], stored: string | null | undefined): string {
  const def = MENU_RECORDINGS[menu].keys as readonly string[];
  if (order.length !== def.length || !def.every((k) => order.includes(k))) throw new Error("The order must hold every recording of this menu once.");
  let all: Record<string, unknown> = {};
  try {
    all = JSON.parse(stored || "{}");
  } catch {
    all = {};
  }
  return JSON.stringify({ ...all, [menu]: order });
}
