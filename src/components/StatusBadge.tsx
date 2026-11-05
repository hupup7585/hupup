import type { OrderStatus } from "@/lib/db/schema";

/** Shared status colors: Scheduled = light blue, Pending / in progress = yellow, Done = navy. */
const MAP: Record<OrderStatus, [string, string]> = {
  HOLD: ["On hold · in call", "badge-pending"],
  PENDING_PAYMENT: ["Awaiting payment", "badge-pending"],
  CONFIRMED: ["Confirmed", "badge-scheduled"],
  DELIVERED: ["Delivered", "badge-done"],
  PICKED_UP: ["Picked up", "badge-done"],
  CANCELLED: ["Cancelled", "badge-muted line-through"],
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  const [label, cls] = MAP[status] ?? [status, ""];
  return <span className={`badge ${cls}`}>{label}</span>;
}

export const STATUS_LABEL = Object.fromEntries(Object.entries(MAP).map(([k, v]) => [k, v[0]])) as Record<OrderStatus, string>;
