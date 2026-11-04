import { Castle, Crosshair, PartyPopper, Sailboat, type LucideIcon } from "lucide-react";

/** Pick a Lucide icon for a rental category by its name (falls back to a party icon for new categories). */
export function categoryIcon(name: string): LucideIcon {
  const n = name.toLowerCase();
  if (n.includes("jumping") || n.includes("balloon") || n.includes("bounce") || n.includes("jumper") || n.includes("castle")) return Castle;
  if (n.includes("laser") || n.includes("maze") || n.includes("tag")) return Crosshair;
  if (n.includes("boat") || n.includes("paddle") || n.includes("water")) return Sailboat;
  return PartyPopper;
}
