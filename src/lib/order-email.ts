import { BUSINESS_NAME, config } from "@/lib/config";
import { dualDate } from "@/lib/dual-date";
import { formatPhone } from "@/lib/phone";
import { orderNumber, type getOrderWithItems } from "@/lib/orders";

type Full = NonNullable<Awaited<ReturnType<typeof getOrderWithItems>>>;
const money = (c: number | null | undefined) => `$${((c ?? 0) / 100).toFixed(2)}`;

/**
 * The order details emailed to the business when an order is paid (Abraham's checklist: "email the business the
 * order details"). Goes only to the business (ADMIN_EMAIL), never to customers. English and Hebrew dates.
 */
export function businessOrderEmail(full: Full, paidCents: number): { subject: string; text: string } {
  const o = full.order;
  const num = orderNumber(o.id);
  const c = full.customer;
  const lines = [
    `New paid order #${num} (${o.channel === "PHONE" ? "booked by phone" : "booked in person"})`,
    "",
    `Delivery: ${dualDate(o.eventDate)}${o.deliveryTime ? ` at ${o.deliveryTime}` : ""}`,
    `Pickup: ${dualDate(o.pickupDate)}`,
    `Address: ${o.deliveryAddress || "not given"}`,
    "",
    `Customer: ${c?.name || "no name"}`,
    `Phone: ${c?.phone ? formatPhone(c.phone) : "not given"}`,
    `Email: ${c?.email || "not given"}`,
    "",
    "Items:",
    ...full.items.map((i) => `  ${i.qty} x ${i.name} at ${money(i.unitPriceCents)}`),
    "",
    `Rentals: ${money(o.subtotalCents)}`,
    `Delivery: ${money(o.deliveryFeeCents)}`,
    `Sales tax: ${money(o.taxCents)}`,
    `Total: ${money(o.totalCents || o.subtotalCents)}`,
    `Paid now: ${money(paidCents)}`,
    ...(o.notes ? ["", `Notes: ${o.notes}`] : []),
    "",
    `Open the order: ${config.baseUrl()}/admin/orders/${o.id}`,
  ];
  return { subject: `${BUSINESS_NAME}: new paid order #${num} for ${dualDate(o.eventDate, "short")}`, text: lines.join("\n") };
}
