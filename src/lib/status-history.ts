import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";

import { STATUS_LABEL as BADGE } from "@/components/StatusBadge";

/** Staff words for each booking status (the same as the status badges). */
export const STATUS_LABEL: Record<string, string> = BADGE;

/**
 * Add who and why to the newest change of this order to this status (the database trigger already saved the change
 * itself). Changes without a reason keep an empty reason; nothing is ever overwritten once explained.
 */
export async function explainStatus(orderId: number, toStatus: string, reason: string, userId: number | null = null) {
  const [row] = await db
    .select({ id: schema.orderStatusHistory.id })
    .from(schema.orderStatusHistory)
    .where(and(eq(schema.orderStatusHistory.orderId, orderId), eq(schema.orderStatusHistory.toStatus, toStatus), isNull(schema.orderStatusHistory.reason)))
    .orderBy(desc(schema.orderStatusHistory.id))
    .limit(1);
  if (row) await db.update(schema.orderStatusHistory).set({ reason: reason.slice(0, 500), userId }).where(eq(schema.orderStatusHistory.id, row.id));
}

export async function statusHistory(orderId: number) {
  return db
    .select({ h: schema.orderStatusHistory, who: schema.adminUsers.name })
    .from(schema.orderStatusHistory)
    .leftJoin(schema.adminUsers, eq(schema.adminUsers.id, schema.orderStatusHistory.userId))
    .where(eq(schema.orderStatusHistory.orderId, orderId))
    .orderBy(asc(schema.orderStatusHistory.at), asc(schema.orderStatusHistory.id));
}
