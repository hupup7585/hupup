export * from "@/lib/item-types";
import { LASER_ROLE_POOLS, type LaserRole } from "@/lib/item-types";

/** The laser gun pools a role means (to compare with availability's own name rule). */
export const laserPoolsMatch = (r: LaserRole): string[] => [...LASER_ROLE_POOLS[r]];
