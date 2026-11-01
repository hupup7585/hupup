import type { OrderStatus } from "@/lib/db/schema";

const MAP: Record<OrderStatus, [string, string]> = {
  HOLD: ["On hold · in call", "bg-[#FFE6E4] text-[#C83A2F]"],
  PENDING_PAYMENT: ["Awaiting payment", "bg-[#FFF4D6] text-[#A87800]"],
  CONFIRMED: ["Confirmed", "bg-[#E3F8EF] text-[#13895C]"],
  DELIVERED: ["Delivered", "bg-[#E5F3FF] text-[#1170C0]"],
  PICKED_UP: ["Picked up", "bg-[#EEF0F5] text-[#4B5878]"],
  CANCELLED: ["Cancelled", "bg-[#F3F4F6] text-[#8A94A6] line-through"],
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  const [label, cls] = MAP[status] ?? [status, ""];
  return <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${cls}`}>{label}</span>;
}

export const STATUS_LABEL = Object.fromEntries(Object.entries(MAP).map(([k, v]) => [k, v[0]])) as Record<OrderStatus, string>;
