"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { assignDriver } from "@/lib/drivers";
import { orderPath } from "@/lib/order-path";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/** Owner and Secretary: set the delivery and pickup drivers of an order (blank = not assigned). */
export async function assignDriversAction(orderId: number, form: FormData) {
  const s = await requireStaff(["owner", "secretary"]);
  // Extra check HD5 + HD6 (Nov 27, 2026): both choices are checked before anything is saved. A stop whose driver didn't
  // change is left alone (a deactivated driver stays on it); a choice that is no longer an active driver (deactivated
  // while the page was open) leaves that stop as it was instead of a half-save and an error page.
  const [o] = await db.select({ d: schema.orders.deliveryDriverId, p: schema.orders.pickupDriverId }).from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
  if (!o) return;
  const want = (stop: "delivery" | "pickup") => {
    const v = String(form.get(stop) ?? "");
    return v ? Number(v) : null;
  };
  const changes: { stop: "delivery" | "pickup"; id: number | null }[] = [];
  for (const stop of ["delivery", "pickup"] as const) {
    const id = want(stop);
    const current = stop === "delivery" ? o.d : o.p;
    if (id === current) continue;
    if (id !== null) {
      const [d] = await db.select({ role: schema.adminUsers.role, active: schema.adminUsers.active }).from(schema.adminUsers).where(eq(schema.adminUsers.id, id)).limit(1);
      if (!d || d.role !== "delivery" || !d.active) continue;
    }
    changes.push({ stop, id });
  }
  for (const c of changes) await assignDriver(orderId, c.stop, c.id, s.userId);
  revalidatePath(orderPath(orderId));
  revalidatePath("/admin/deliveries");
}
