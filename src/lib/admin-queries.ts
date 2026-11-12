import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { addDays, daysBetween, startOfWeek } from "@/lib/dates";
import type { OrderStatus, Channel } from "@/lib/db/schema";

/** Statuses that count as real (booked) revenue. */
const BOOKED = sql`o.status IN ('CONFIRMED','DELIVERED','PICKED_UP')`;

type Row = Record<string, unknown>;
const rows = async <T>(q: ReturnType<typeof sql>) => (await db.execute(q)).rows as T[];

export async function kpis(from: string, to: string) {
  const len = daysBetween(from, to).length;
  const prevFrom = addDays(from, -len);
  const prevTo = addDays(from, -1);
  const [cur] = await rows<{ revenue: number; orders: number; paid: number }>(sql`
    SELECT COALESCE(SUM(o.subtotal_cents),0)::int AS revenue, COUNT(*)::int AS orders, COALESCE(SUM(o.paid_cents),0)::int AS paid
    FROM orders o WHERE ${BOOKED} AND o.event_date BETWEEN ${from}::date AND ${to}::date`);
  const [prev] = await rows<{ revenue: number; orders: number }>(sql`
    SELECT COALESCE(SUM(o.subtotal_cents),0)::int AS revenue, COUNT(*)::int AS orders
    FROM orders o WHERE ${BOOKED} AND o.event_date BETWEEN ${prevFrom}::date AND ${prevTo}::date`);
  const [pending] = await rows<{ n: number; cents: number }>(sql`
    SELECT COUNT(*)::int AS n, COALESCE(SUM(subtotal_cents),0)::int AS cents FROM orders o
    WHERE o.status = 'PENDING_PAYMENT' AND (o.hold_expires_at IS NULL OR o.hold_expires_at > now())`);
  // Utilization: unit-days booked / unit-days owned in the range.
  const [util] = await rows<{ booked: number; owned: number }>(sql`
    SELECT
      (SELECT COALESCE(SUM(oi.qty),0)::int FROM order_items oi JOIN orders o ON o.id = oi.order_id
         CROSS JOIN LATERAL (VALUES (o.event_date),(o.pickup_date)) d(day)
         WHERE ${BOOKED} AND d.day BETWEEN ${from}::date AND ${to}::date) AS booked,
      (SELECT COALESCE(SUM(quantity),0)::int * ${len} FROM products WHERE active) AS owned`);
  return {
    revenue: cur.revenue,
    orders: cur.orders,
    paid: cur.paid,
    prevRevenue: prev.revenue,
    prevOrders: prev.orders,
    pendingCount: pending.n,
    pendingCents: pending.cents,
    utilization: util.owned ? util.booked / util.owned : 0,
  };
}

export async function todaysRuns(today: string) {
  const [r] = await rows<{ deliveries: number; pickups: number }>(sql`
    SELECT
      COUNT(*) FILTER (WHERE o.event_date = ${today}::date)::int AS deliveries,
      COUNT(*) FILTER (WHERE o.pickup_date = ${today}::date)::int AS pickups
    FROM orders o WHERE o.status IN ('CONFIRMED','DELIVERED','PENDING_PAYMENT')
       OR (o.status = 'PICKED_UP' AND o.pickup_date = ${today}::date)`);
  return r;
}

/** Booked revenue by event week: the last few weeks plus upcoming weeks already on the books. */
export async function weeklyRevenue(today: string, weeksBack = 4, weeksAhead = 3) {
  const weeks = weeksBack + 1 + weeksAhead;
  const start = addDays(startOfWeek(today), -7 * weeksBack);
  const end = addDays(start, weeks * 7 - 1);
  const data = await rows<{ week: string; channel: Channel; cents: number }>(sql`
    SELECT date_trunc('week', o.event_date)::date::text AS week, o.channel, SUM(o.subtotal_cents)::int AS cents
    FROM orders o WHERE ${BOOKED} AND o.event_date BETWEEN ${start}::date AND ${end}::date
    GROUP BY 1, 2`);
  const out: { week: string; phone: number; pos: number }[] = [];
  for (let i = 0; i < weeks; i++) {
    const w = addDays(start, i * 7);
    out.push({
      week: w,
      phone: data.find((d) => d.week === w && d.channel === "PHONE")?.cents ?? 0,
      pos: data.find((d) => d.week === w && d.channel === "POS")?.cents ?? 0,
    });
  }
  return out;
}

export async function leaderboard(from: string, to: string, limit = 6) {
  return rows<{ id: number; name: string; category: string; bookings: number; units: number; cents: number }>(sql`
    SELECT p.id, p.name, c.name AS category, COUNT(DISTINCT o.id)::int AS bookings, SUM(oi.qty)::int AS units,
           SUM(oi.qty * oi.unit_price_cents)::int AS cents
    FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id
    JOIN categories c ON c.id = p.category_id
    WHERE ${BOOKED} AND o.event_date BETWEEN ${from}::date AND ${to}::date
    GROUP BY p.id, p.name, c.name ORDER BY cents DESC LIMIT ${limit}`);
}

export async function channelSplit(from: string, to: string) {
  return rows<{ channel: Channel; n: number; cents: number }>(sql`
    SELECT o.channel, COUNT(*)::int AS n, SUM(o.subtotal_cents)::int AS cents FROM orders o
    WHERE ${BOOKED} AND o.event_date BETWEEN ${from}::date AND ${to}::date GROUP BY 1`);
}

export type OrderListRow = {
  id: number;
  status: OrderStatus;
  channel: Channel;
  event_date: string;
  pickup_date: string;
  subtotal_cents: number;
  /** Items + delivery + tax (null for orders not priced yet) */
  total_cents: number | null;
  paid_cents: number;
  payment_result: string | null;
  refunded_cents: number;
  payment_result_at: string | null;
  card_last4: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  delivery_address: string | null;
  items: string | null;
  created_at: string;
  hold_expires_at: string | null;
  notes: string | null;
};

export async function listOrders(f: { q?: string; status?: string; from?: string; to?: string; limit?: number }) {
  const conds = [sql`TRUE`];
  if (f.status === "OPEN") conds.push(sql`o.status IN ('PENDING_PAYMENT','CONFIRMED','DELIVERED')`);
  else if (f.status === "ALL" || !f.status) conds.push(sql`NOT (o.status = 'CANCELLED' AND o.customer_id IS NULL)`); // hide abandoned phone carts
  else conds.push(sql`o.status = ${f.status}`);
  if (f.from) conds.push(sql`o.event_date >= ${f.from}::date`);
  if (f.to) conds.push(sql`o.event_date <= ${f.to}::date`);
  if (f.q) {
    const like = `%${f.q.trim()}%`;
    const num = Number(f.q.replace(/\D/g, ""));
    conds.push(sql`(c.name ILIKE ${like} OR c.phone ILIKE ${like} OR o.delivery_address ILIKE ${like}
      ${num ? sql`OR o.id = ${num - 1000}` : sql``})`);
  }
  const where = sql.join(conds.map((c) => sql`(${c})`), sql` AND `);
  return rows<OrderListRow>(sql`
    SELECT o.id, o.status, o.channel, o.event_date::text, o.pickup_date::text, o.subtotal_cents, o.total_cents, o.paid_cents,
           o.payment_result, o.payment_result_at::text, o.card_last4, o.refunded_cents, o.delivery_address, o.created_at::text, o.hold_expires_at::text, o.notes,
           c.name AS customer_name, c.phone AS customer_phone,
           (SELECT string_agg(oi.qty || ' × ' || p.name, ', ' ORDER BY oi.id) FROM order_items oi
              JOIN products p ON p.id = oi.product_id WHERE oi.order_id = o.id) AS items
    FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
    WHERE ${where}
    ORDER BY o.event_date DESC, o.id DESC
    LIMIT ${f.limit ?? 200}`);
}

export async function runsForDay(day: string) {
  return rows<{
    id: number; kind: "delivery" | "pickup"; status: OrderStatus; delivery_time: string | null;
    customer_name: string | null; customer_phone: string | null; delivery_address: string | null; items: string | null;
  }>(sql`
    SELECT o.id, CASE WHEN o.event_date = ${day}::date THEN 'delivery' ELSE 'pickup' END AS kind, o.status,
           o.delivery_time, c.name AS customer_name, c.phone AS customer_phone, o.delivery_address,
           (SELECT string_agg(oi.qty || ' × ' || p.name, ', ' ORDER BY oi.id) FROM order_items oi
              JOIN products p ON p.id = oi.product_id WHERE oi.order_id = o.id) AS items
    FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
    WHERE (o.event_date = ${day}::date OR o.pickup_date = ${day}::date)
      AND (o.status IN ('PENDING_PAYMENT','CONFIRMED','DELIVERED','PICKED_UP'))
    ORDER BY kind, o.delivery_time NULLS LAST, o.id`);
}

export async function recentCalls(limit = 100) {
  return rows<Row & {
    call_sid: string; from_number: string | null; order_id: number | null; status: string; outcome: string;
    started_at: string; ended_at: string | null; customer_name: string | null; order_status: OrderStatus | null; subtotal_cents: number | null;
  }>(sql`
    SELECT s.call_sid, s.from_number, s.order_id, s.status, s.outcome, s.started_at::text, s.ended_at::text,
           s.data->>'name' AS customer_name, o.status AS order_status, o.subtotal_cents
    FROM call_sessions s LEFT JOIN orders o ON o.id = s.order_id
    ORDER BY s.started_at DESC LIMIT ${limit}`);
}
