import { getSession } from "@/lib/auth";
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
  if (!(await getSession())) return new Response("Unauthorized", { status: 401 });
  const u = new URL(req.url);
  const list = await listOrders({
    q: u.searchParams.get("q") || undefined,
    status: u.searchParams.get("status") || "ALL",
    from: u.searchParams.get("from") || undefined,
    to: u.searchParams.get("to") || undefined,
    limit: 10000,
  });
  const header = ["Order", "Status", "Channel", "Event date", "Pickup date", "Customer", "Phone", "Address", "Items", "Total", "Paid", "Notes"];
  const lines = list.map((o) =>
    [orderNumber(o.id), o.status, o.channel, o.event_date, o.pickup_date, o.customer_name, o.customer_phone, o.delivery_address, o.items,
      (o.subtotal_cents / 100).toFixed(2), (o.paid_cents / 100).toFixed(2), o.notes].map(cell).join(","),
  );
  return new Response([header.map(cell).join(","), ...lines].join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="hupup-orders.csv"`,
    },
  });
}
