export * from "@/lib/item-types";
import type { LaserRole } from "@/lib/item-types";

/** The laser gun pools a role means (to compare with availability's own name rule). */
export function laserPoolsMatch(r: LaserRole): string[] {
  const m: Record<LaserRole, string[]> = { maze_six: ["maze", "six"], maze_four: ["maze", "four"], maze: ["maze"], six_guns: ["six"], four_guns: ["four"], none: [] };
  return m[r];
}
