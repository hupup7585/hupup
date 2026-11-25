import { asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { config } from "@/lib/config";
import { sendEmail } from "@/lib/notify";
import { orderPath } from "@/lib/order-path";

/*
 * Delivery statuses (Abraham, Nov 15, 2026): Booked, Out for delivery, Delivered, Out for pickup, Picked up,
 * Problem reported. Each change is saved with its time and the staff member; "Problem reported" emails the office.
 */
export type Stop = "delivery" | "pickup";
export type Stage = "booked" | "out_for_delivery" | "delivered" | "out_for_pickup" | "picked_up" | "problem";

export const STAGE_LABEL: Record<Stage, string> = {
  booked: "Booked",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  out_for_pickup: "Out for pickup",
  picked_up: "Picked up",
  problem: "Problem reported",
};

/** Which stages a stop can move to by the driver's buttons. */
export const STOP_STAGES: Record<Stop, Stage[]> = {
  delivery: ["out_for_delivery", "delivered", "problem"],
  pickup: ["out_for_pickup", "picked_up", "problem"],
};

export type StageNow = { stage: Stage; at: Date | null; note: string | null; history: { stage: Stage; at: Date; note: string | null; userId: number | null }[] };

/** The current stage of each stop (latest event), "Booked" when nothing happened yet. Key: `${orderId}-${stop}`. */
export async function stagesFor(orderIds: number[]): Promise<Map<string, StageNow>> {
  const out = new Map<string, StageNow>();
  if (!orderIds.length) return out;
  const rows = await db.select().from(schema.deliveryEvents).where(inArray(schema.deliveryEvents.orderId, orderIds)).orderBy(asc(schema.deliveryEvents.at), asc(schema.deliveryEvents.id));
  for (const r of rows) {
    const key = `${r.orderId}-${r.stop}`;
    const cur = out.get(key) ?? { stage: "booked" as Stage, at: null, note: null, history: [] };
    cur.history.push({ stage: r.stage as Stage, at: r.at, note: r.note, userId: r.userId });
    cur.stage = r.stage as Stage;
    cur.at = r.at;
    cur.note = r.note;
    out.set(key, cur);
  }
  return out;
}

export async function stageOf(orderId: number, stop: Stop): Promise<Stage> {
  return (await stagesFor([orderId])).get(`${orderId}-${stop}`)?.stage ?? "booked";
}

/** Save a stage change. A problem needs a short note and emails the Owner. */
export async function recordStage(orderId: number, stop: Stop, stage: Stage, userId: number | null, note?: string | null, who?: string) {
  if (!STOP_STAGES[stop].includes(stage)) throw new Error("That status isn't for this stop.");
  const clean = (note ?? "").trim().slice(0, 500) || null;
  if (stage === "problem" && !clean) throw new Error("Please say what the problem is.");
  await db.insert(schema.deliveryEvents).values({ orderId, stop, stage, note: clean, userId });
  if (stage === "problem") {
    const to = config.adminEmail();
    const { orderNumber } = await import("@/lib/orders");
    const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
    if (to)
      await sendEmail(
        to,
        `Hup Up Attractions: problem on the ${stop} for order #${orderNumber(orderId)}`,
        `${who ?? "A driver"} reported a problem on the ${stop} for order #${orderNumber(orderId)}${o?.deliveryAddress ? ` (${o.deliveryAddress})` : ""}:\n\n${clean}\n\n${config.baseUrl()}${orderPath(orderId)}`,
      ).catch(() => null);
  }
}
