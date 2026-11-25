/*
 * Box 56, the price lines (Abraham, Nov 24, 2026, 21:02, approved):
 *   "Your order number is {number}."
 *   "Your total is {total}."
 *   "That includes {amount} {type}, {delivery} for delivery, and {tax} sales tax."
 * {amount} {type} repeats once per rental kind in the cart, each with its own subtotal; no quantity is spoken; the
 * plural clip for more than one of that kind. The kind comes from the Catalog data that exists today (no new field):
 * the category name, and for the paddle boat package its own Catalog item in the paddle category (name with "pool" or
 * "package").
 */

export type RentalKind = "jumping_balloon" | "laser_tag_set" | "paddle_boat" | "paddle_boat_package";

/** The eight type clips (each its own Admin slot, text exactly as approved). */
export const TYPE_CLIPS: Record<RentalKind, { one: string; more: string }> = {
  jumping_balloon: { one: "for the jumping balloon", more: "for the jumping balloons" },
  laser_tag_set: { one: "for the laser tag set", more: "for the laser tag sets" },
  paddle_boat: { one: "for the paddle boat", more: "for the paddle boats" },
  paddle_boat_package: { one: "for the paddle boat package", more: "for the paddle boat packages" },
};
export const typeSlotKey = (kind: RentalKind, plural: boolean) => `type:${kind}${plural ? "s" : ""}`;

/**
 * Which kind a cart line is, and whether it counts toward one-or-more (add-ons do not). Laser add-on packs go with
 * the laser tag sets; ocean balls go with the jumping balloons (no type clip of their own; pending Abraham).
 */
export function rentalKind(categoryName: string, productName: string): { kind: RentalKind; counts: boolean } {
  const c = categoryName.toLowerCase();
  if (/paddle/.test(c)) return { kind: /pool|package/i.test(productName) ? "paddle_boat_package" : "paddle_boat", counts: true };
  if (/laser|maze/.test(c)) return { kind: "laser_tag_set", counts: !/add-?ons?/.test(c) };
  if (/ocean/.test(c)) return { kind: "jumping_balloon", counts: false };
  return { kind: "jumping_balloon", counts: true };
}

export type Box56Line = { categoryName: string; productName: string; qty: number; cents: number };
export type Box56Group = { kind: RentalKind; cents: number; count: number };

/**
 * Subtotals per kind for one rental day, scaled to that day's order subtotal (offers, whole rental days), so the
 * parts always add up to the order exactly (largest remainder on whole cents).
 */
export function dayGroups(lines: Box56Line[], subtotalCents: number): Box56Group[] {
  const raw = lines.reduce((n, l) => n + l.cents, 0);
  const shares = lines.map((l) => (raw > 0 ? (l.cents * subtotalCents) / raw : 0));
  const floors = shares.map(Math.floor);
  let left = subtotalCents - floors.reduce((a, b) => a + b, 0);
  shares
    .map((s, i) => ({ i, r: s - Math.floor(s) }))
    .sort((a, b) => b.r - a.r)
    .forEach(({ i }) => {
      if (left > 0) {
        floors[i]++;
        left--;
      }
    });
  const out: Box56Group[] = [];
  lines.forEach((l, i) => {
    const { kind, counts } = rentalKind(l.categoryName, l.productName);
    let g = out.find((x) => x.kind === kind);
    if (!g) out.push((g = { kind, cents: 0, count: 0 }));
    g.cents += floors[i];
    if (counts) g.count += l.qty;
  });
  return out;
}

/** All rental days together: one subtotal per kind, in the order the kinds first appear. */
export function box56Groups(days: { lines: Box56Line[]; subtotalCents: number }[]): Box56Group[] {
  const out: Box56Group[] = [];
  for (const d of days)
    for (const g of dayGroups(d.lines, d.subtotalCents)) {
      const o = out.find((x) => x.kind === g.kind);
      if (o) {
        o.cents += g.cents;
        o.count += g.count;
      } else out.push({ ...g });
    }
  return out;
}

/** The type clip text for a group: plural for more than one of that kind. */
export const typeClip = (g: Box56Group) => (g.count > 1 ? TYPE_CLIPS[g.kind].more : TYPE_CLIPS[g.kind].one);
