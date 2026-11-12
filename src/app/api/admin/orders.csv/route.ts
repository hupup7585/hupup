import { currentStaff } from "@/lib/auth";
import { listOrders } from "@/lib/admin-queries";
import { orderNumber } from "@/lib/orders";

export const dynamic = "force-dynamic";

function cell(v: unknown) {
  const s = v === null || v === undefined ? "" : String(v);
  // Guard against spreadsheet formula injection and escape quotes.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function GET(req: Request) {
  const staff = await currentStaff();
  if (!staff) return new Response("Unauthorized", { status: 401 });
  if (staff.role !== "owner") return new Response("Forbidden: finances are owner-only", { status: 403 });
  const u = new URL(req.url);
  const list = await listOrders({
    q: u.searchParams.get("q") || undefined,
    status: u.searchParams.get("status") || "ALL",
    from: u.searchParams.get("from") || undefined,
    to: u.searchParams.get("to") || undefined,
    limit: 10000,
  });
  const header = ["Order", "Status", "Channel", "Event date", "Pickup date", "Customer", "Phone", "Address", "Items", "Total", "Paid", "Payment", "Payment date and time", "Card last 4", "Refund", "Refunded", "Notes"];
  const lines = list.map((o) =>
    [orderNumber(o.id), o.status, o.channel, o.event_date, o.pickup_date, o.customer_name, o.customer_phone, o.delivery_address, o.items,
      ((o.total_cents ?? o.subtotal_cents) / 100).toFixed(2), (o.paid_cents / 100).toFixed(2),
      o.payment_result === "approved" ? "Paid" : o.payment_result === "declined" ? "Declined" : "",
      o.payment_result_at ? new Date(o.payment_result_at).toLocaleString("en-US", { timeZone: "America/New_York", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "",
      o.card_last4 ?? "",
      o.refunded_cents ? (o.refunded_cents >= o.paid_cents ? "Refunded" : "Partly refunded") : "",
      o.refunded_cents ? (o.refunded_cents / 100).toFixed(2) : "",
      o.notes].map(cell).join(","),
  );
  return new Response([header.map(cell).join(","), ...lines].join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="hupup-orders.csv"`,
    },
  });
}
