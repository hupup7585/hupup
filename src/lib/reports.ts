import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import type { Role } from "@/lib/db/schema";
import { listOrders, kpis, channelSplit, leaderboard, recentCalls } from "@/lib/admin-queries";
import { orderNumber } from "@/lib/orders";
import { addDays, daysBetween } from "@/lib/dates";
import type { Sheet } from "@/lib/xlsx";

/**
 * Every admin list that can be downloaded as a sheet. Adding a report here gives it the
 * "Export to Excel" button (and CSV) automatically. Money columns are Owner-only.
 * Columns only use fields that exist on the live database today.
 */
export type ReportParams = { q?: string; status?: string; from?: string; to?: string };
type Report = { title: string; file: string; roles: Role[]; build: (p: ReportParams) => Promise<Sheet[]> };

const money = (cents: number | null | undefined) => (cents == null ? null : Math.round(cents) / 100);
const rows = async <T>(q: ReturnType<typeof sql>) => (await db.execute(q)).rows as T[];

export const REPORTS: Record<string, Report> = {
  bookings: {
    title: "Bookings",
    file: "hupup-bookings",
    roles: ["owner"],
    build: async (p) => {
      const list = await listOrders({ q: p.q, status: p.status || "ALL", from: p.from, to: p.to, limit: 10000 });
      return [
        {
          name: "Bookings",
          header: ["Order", "Status", "Channel", "Event date", "Pickup date", "Customer", "Phone", "Address", "Items", "Subtotal ($)", "Paid ($)", "Notes"],
          rows: list.map((o) => [orderNumber(o.id), o.status, o.channel, o.event_date, o.pickup_date, o.customer_name, o.customer_phone, o.delivery_address, o.items, money(o.subtotal_cents), money(o.paid_cents), o.notes]),
        },
      ];
    },
  },

  payments: {
    title: "Payments",
    file: "hupup-payments",
    roles: ["owner"],
    build: async (p) => {
      const list = await rows<{ id: number; event_date: string; status: string; name: string | null; phone: string | null; subtotal_cents: number; paid_cents: number; payment_method: string | null; sola_ref_num: string | null; updated_at: string }>(sql`
        SELECT o.id, o.event_date::text, o.status, c.name, c.phone, o.subtotal_cents, o.paid_cents, o.payment_method, o.sola_ref_num, o.updated_at::text
        FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
        WHERE o.paid_cents > 0
          ${p.from ? sql`AND o.event_date >= ${p.from}::date` : sql``}
          ${p.to ? sql`AND o.event_date <= ${p.to}::date` : sql``}
        ORDER BY o.event_date DESC, o.id DESC LIMIT 10000`);
      return [
        {
          name: "Payments",
          header: ["Order", "Event date", "Status", "Customer", "Phone", "Subtotal ($)", "Paid ($)", "Balance ($)", "Method", "Sola reference", "Last updated"],
          rows: list.map((o) => [orderNumber(o.id), o.event_date, o.status, o.name, o.phone, money(o.subtotal_cents), money(o.paid_cents), money(o.subtotal_cents - o.paid_cents), o.payment_method, o.sola_ref_num, o.updated_at?.slice(0, 16)]),
        },
      ];
    },
  },

  customers: {
    title: "Customers",
    file: "hupup-customers",
    roles: ["owner", "secretary"],
    build: async (p) => {
      const like = p.q ? `%${p.q.trim()}%` : null;
      const list = await rows<{ name: string | null; phone: string; email: string | null; address: string | null; marketing_opt_in: boolean; sms_opt_out: boolean; orders: number; last_event: string | null; created_at: string }>(sql`
        SELECT c.name, c.phone, c.email, c.address, c.marketing_opt_in, c.sms_opt_out, c.created_at::text,
               (SELECT COUNT(*)::int FROM orders o WHERE o.customer_id = c.id AND o.status <> 'CANCELLED') AS orders,
               (SELECT MAX(o.event_date)::text FROM orders o WHERE o.customer_id = c.id AND o.status <> 'CANCELLED') AS last_event
        FROM customers c
        ${like ? sql`WHERE c.name ILIKE ${like} OR c.phone ILIKE ${like} OR c.email ILIKE ${like}` : sql``}
        ORDER BY c.created_at DESC LIMIT 20000`);
      return [
        {
          name: "Customers",
          header: ["Name", "Phone", "Email", "Address", "Bookings", "Last event date", "Promotional texts", "Replied STOP", "Customer since"],
          rows: list.map((c) => [c.name, c.phone, c.email, c.address, c.orders, c.last_event, c.marketing_opt_in ? "Yes" : "No", c.sms_opt_out ? "Yes" : "No", c.created_at?.slice(0, 10)]),
        },
      ];
    },
  },

  deliveries: {
    title: "Deliveries and pickups",
    file: "hupup-deliveries",
    roles: ["owner", "secretary"],
    build: async (p) => {
      const from = p.from || new Date().toISOString().slice(0, 10);
      const to = p.to || addDays(from, 6);
      const list = await rows<{ day: string; kind: string; id: number; status: string; delivery_time: string | null; name: string | null; phone: string | null; address: string | null; items: string | null }>(sql`
        SELECT d.day::text, d.kind, o.id, o.status, o.delivery_time, c.name, c.phone, o.delivery_address AS address,
               (SELECT string_agg(oi.qty || ' × ' || pr.name, ', ' ORDER BY oi.id) FROM order_items oi JOIN products pr ON pr.id = oi.product_id WHERE oi.order_id = o.id) AS items
        FROM orders o
        CROSS JOIN LATERAL (VALUES (o.event_date, 'Delivery'), (o.pickup_date, 'Pickup')) d(day, kind)
        LEFT JOIN customers c ON c.id = o.customer_id
        WHERE d.day BETWEEN ${from}::date AND ${to}::date AND o.status IN ('PENDING_PAYMENT','CONFIRMED','DELIVERED','PICKED_UP')
        ORDER BY d.day, d.kind, o.delivery_time NULLS LAST, o.id`);
      return [
        {
          name: "Deliveries and pickups",
          header: ["Date", "Type", "Order", "Status", "Time", "Customer", "Phone", "Address", "Items"],
          rows: list.map((r) => [r.day, r.kind, orderNumber(r.id), r.status, r.delivery_time, r.name, r.phone, r.address, r.items]),
        },
      ];
    },
  },

  calls: {
    title: "Call log",
    file: "hupup-calls",
    roles: ["owner", "secretary"],
    build: async () => {
      const list = await recentCalls(5000);
      return [
        {
          name: "Call log",
          header: ["Started", "Ended", "From", "Caller name", "Outcome", "Status", "Order", "Order status"],
          rows: list.map((c) => [c.started_at?.slice(0, 16), c.ended_at?.slice(0, 16), c.from_number, c.customer_name, c.outcome, c.status, c.order_id ? orderNumber(c.order_id) : null, c.order_status]),
        },
      ];
    },
  },

  dashboard: {
    title: "Dashboard report",
    file: "hupup-dashboard",
    roles: ["owner"],
    build: async (p) => {
      const to = p.to || new Date().toISOString().slice(0, 10);
      const from = p.from || addDays(to, -29);
      const [k, ch, top] = await Promise.all([kpis(from, to), channelSplit(from, to), leaderboard(from, to, 50)]);
      return [
        {
          name: "Summary",
          header: ["Measure", "Value"],
          rows: [
            ["Period", `${from} to ${to} (${daysBetween(from, to).length} days)`],
            ["Revenue, booked ($)", money(k.revenue)],
            ["Bookings", k.orders],
            ["Paid ($)", money(k.paid)],
            ["Previous period revenue ($)", money(k.prevRevenue)],
            ["Previous period bookings", k.prevOrders],
            ["Awaiting payment (count)", k.pendingCount],
            ["Awaiting payment ($)", money(k.pendingCents)],
            ["Utilization", Math.round(k.utilization * 1000) / 10 + "%"],
          ],
        },
        { name: "By channel", header: ["Channel", "Bookings", "Revenue ($)"], rows: ch.map((r) => [r.channel, r.n, money(r.cents)]) },
        { name: "Top items", header: ["Item", "Category", "Bookings", "Units", "Revenue ($)"], rows: top.map((r) => [r.name, r.category, r.bookings, r.units, money(r.cents)]) },
      ];
    },
  },
};

export function reportFor(key: string, role: Role): { report: Report } | { error: string; status: number } {
  const report = REPORTS[key];
  if (!report) return { error: "Unknown report", status: 404 };
  if (!report.roles.includes(role)) return { error: "You don't have access to this report", status: 403 };
  return { report };
}
