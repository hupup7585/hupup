"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { assignDriver } from "@/lib/drivers";

/** Owner and Secretary: set the delivery and pickup drivers of an order (blank = not assigned). */
export async function assignDriversAction(orderId: number, form: FormData) {
  const s = await requireStaff(["owner", "secretary"]);
  for (const stop of ["delivery", "pickup"] as const) {
    const v = String(form.get(stop) ?? "");
    await assignDriver(orderId, stop, v ? Number(v) : null, s.userId);
  }
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/deliveries");
}
