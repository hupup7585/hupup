/**
 * Payment link prefill (Abraham, Nov 26, 2026, 13:25 ET): when the secure card page opens, everything the customer
 * already gave is filled in from the order (name, phone, email, delivery address, the items and the delivery and pickup
 * dates), whichever way the link was made: a phone caller who asked for a link, the automatic link, or staff in Admin
 * or New booking. The customer types only the card details (and can still correct a filled-in field on the card page).
 * Never any card data: only what is already on the order.
 */
export type PrefillOrder = {
  order: { id: number; eventDate: string; pickupDate: string; deliveryAddress?: string | null };
  items: { name: string; qty: number }[];
  customer?: { name?: string | null; email?: string | null; phone?: string | null } | null;
};

export type Prefill = {
  name?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  description?: string;
};

/** "Klein, Sara" (how names are kept) or "Sara Klein" -> first and last name. */
export function splitName(name: string | null | undefined): { firstName?: string; lastName?: string } {
  const n = (name ?? "").replace(/\s+/g, " ").trim();
  if (!n) return {};
  if (n.includes(",")) {
    const [last, first] = n.split(",").map((x) => x.trim());
    return { firstName: first || undefined, lastName: last || undefined };
  }
  const parts = n.split(" ");
  return parts.length === 1 ? { firstName: parts[0] } : { firstName: parts.slice(0, -1).join(" "), lastName: parts.at(-1) };
}

/** "99 Nowhere Lane, Unit 2, Monroe, NY 10950" -> street, city, state, zip (anything unclear stays in the street). */
export function splitAddress(address: string | null | undefined): { street?: string; city?: string; state?: string; zip?: string } {
  const a = (address ?? "").replace(/\s+/g, " ").trim();
  if (!a) return {};
  const parts = a.split(",").map((x) => x.trim()).filter(Boolean);
  const tail = parts.at(-1) ?? "";
  const m = tail.match(/^([A-Za-z]{2})\s+(\d{5})(?:-\d{4})?$/) ?? tail.match(/^(New York)\s+(\d{5})$/i);
  if (m && parts.length >= 3) return { street: parts.slice(0, -2).join(", "), city: parts.at(-2), state: m[1].length === 2 ? m[1].toUpperCase() : "NY", zip: m[2] };
  const zip = a.match(/\b(\d{5})\b(?!.*\d{5})/)?.[1];
  return { street: a, ...(zip ? { zip } : {}) };
}

const dayText = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

/** Everything the order already has, for the secure card page (never card data). */
export function prefillFor(primary: PrefillOrder, days: PrefillOrder[] = [primary], orderNumber?: string): Prefill {
  const c = primary.customer ?? {};
  const address = primary.order.deliveryAddress ?? days.find((d) => d.order.deliveryAddress)?.order.deliveryAddress ?? null;
  const lines = days.map((d) => `${d.items.map((i) => `${i.qty} x ${i.name}`).join(", ")}: delivery ${dayText(d.order.eventDate)}, pickup ${dayText(d.order.pickupDate)}`);
  const description = `${orderNumber ? `Order ${orderNumber}: ` : ""}${lines.join("; ")}`.slice(0, 250);
  return {
    ...(c.name ? { name: c.name } : {}),
    ...splitName(c.name),
    ...(c.email ? { email: c.email } : {}),
    ...(c.phone ? { phone: c.phone } : {}),
    ...splitAddress(address),
    ...(lines.length ? { description } : {}),
  };
}
