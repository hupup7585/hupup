"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireStaff } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { assignDriver } from "@/lib/drivers";
import { orderPath } from "@/lib/order-path";
import { msgQuery } from "@/lib/url-message";

/**
 * Owner and Secretary: set the delivery and pickup drivers of an order (blank = not assigned). Deep check 0600 M24
 * (Nov 27, 2026): a stop whose choice was not changed is left alone (a driver who was since deactivated is no longer
 * removed silently), and a refused choice comes back as a plain message on the order page instead of an error page.
 */
export async function assignDriversAction(orderId: number, form: FormData) {
  const s = await requireStaff(["owner", "secretary"]);
  const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
  const problems: string[] = [];
  for (const stop of ["delivery", "pickup"] as const) {
    const v = String(form.get(stop) ?? "");
    const current = stop === "delivery" ? o?.deliveryDriverId : o?.pickupDriverId;
    if (v === String(current ?? "")) continue;
    try {
      await assignDriver(orderId, stop, v ? Number(v) : null, s.userId);
    } catch (e) {
      problems.push(`${stop === "delivery" ? "Delivery" : "Pickup"} driver not saved: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  revalidatePath(orderPath(orderId));
  revalidatePath("/admin/deliveries");
  redirect(`${orderPath(orderId)}?${msgQuery(problems.length ? problems.join(" ") : "Drivers saved.", "drivers")}`);
}
