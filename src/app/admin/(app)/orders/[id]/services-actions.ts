"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { addService, removeService, ServiceError, updateService, type ServiceInput } from "@/lib/order-services";

/** Owner and Secretary (requireAdmin keeps Delivery out): add, change or remove a custom-amount service on an order. */
export type ServiceResult = { ok: boolean; message: string };

const fromForm = (f: FormData): ServiceInput => ({
  name: String(f.get("name") ?? ""),
  amount: String(f.get("amount") ?? ""),
  note: String(f.get("note") ?? ""),
  showNoteOnReceipt: f.get("showNoteOnReceipt") === "on",
  taxable: f.get("taxable") === "on",
});

async function run(fn: () => Promise<unknown>, done: string): Promise<ServiceResult> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof ServiceError) return { ok: false, message: e.message };
    console.error("order service", e);
    return { ok: false, message: "Not saved. Something went wrong; please try again." };
  }
  revalidatePath("/admin", "layout");
  return { ok: true, message: done };
}

export async function addServiceAction(orderId: number, form: FormData): Promise<ServiceResult> {
  const s = await requireAdmin();
  return run(() => addService(orderId, fromForm(form), s.userId ?? null), "Service added. The total and sales tax are updated.");
}

export async function updateServiceAction(orderId: number, serviceId: number, form: FormData): Promise<ServiceResult> {
  const s = await requireAdmin();
  return run(() => updateService(orderId, serviceId, fromForm(form), s.userId ?? null), "Service saved. The total and sales tax are updated.");
}

export async function removeServiceAction(orderId: number, serviceId: number): Promise<ServiceResult> {
  const s = await requireAdmin();
  return run(() => removeService(orderId, serviceId, s.userId ?? null), "Service removed. The total and sales tax are updated.");
}
