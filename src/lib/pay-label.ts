import { formatMoney } from "@/lib/money";

/**
 * Batch 4 item 2 (Abraham, Nov 25, 2026): one way to show what an order costs and what was paid, everywhere in Admin.
 * The grand total (rentals, delivery and tax), then: "Paid in full", "Not paid · card declined", "Not paid", or
 * "Paid $X · $Y due".
 */
export function payState(o: { totalCents?: number | null; subtotalCents: number; paidCents: number; paymentResult?: string | null }) {
  const total = o.totalCents ?? o.subtotalCents;
  const paid = o.paidCents ?? 0;
  const due = Math.max(0, total - paid);
  let state: string;
  if (total > 0 && paid >= total) state = "Paid in full";
  else if (paid <= 0 && o.paymentResult === "declined") state = "Not paid · card declined";
  else if (paid <= 0) state = "Not paid";
  else state = `Paid ${formatMoney(paid)} · ${formatMoney(due)} due`;
  return { total, paid, due, state, declined: paid <= 0 && o.paymentResult === "declined", label: `Total ${formatMoney(total)} · ${state}` };
}
