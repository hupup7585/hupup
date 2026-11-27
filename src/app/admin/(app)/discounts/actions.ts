"use server";

import { and, eq } from "drizzle-orm";
import { msgQuery } from "@/lib/url-message";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { parseDiscountForm } from "@/lib/customer-discounts";

const back = (m: string) => redirect(`/admin/discounts?${msgQuery(m)}`);

/** Owner: a discount for a customer's phone number (Abraham, Nov 17-18, 2026). Logged. */
export async function addDiscountAction(form: FormData) {
  const owner = await requireOwner();
  const d = parseDiscountForm({
    phone: String(form.get("phone") ?? ""),
    kind: String(form.get("kind") ?? "amount"),
    value: String(form.get("value") ?? ""),
    endsOn: String(form.get("endsOn") ?? ""),
    note: String(form.get("note") ?? ""),
  });
  if ("error" in d) return back(d.error);
  const [row] = await db.insert(schema.customerDiscounts).values({ ...d, percent: d.percent === null ? null : String(d.percent), createdBy: owner.userId }).returning();
  await db.insert(schema.auditLog).values({ userId: owner.userId, action: "discount.added", entityType: "customer_discount", entityId: String(row.id), after: d });
  revalidatePath("/admin/discounts");
  return back("Saved. It counts on this customer's bookings from now on, before tax.");
}

/** Owner: turn a discount off (kept in the list as history). */
export async function turnOffDiscountAction(form: FormData) {
  const owner = await requireOwner();
  const id = Number(form.get("id"));
  if (!id) return back("Not found.");
  await db.update(schema.customerDiscounts).set({ active: false, turnedOffAt: new Date() }).where(and(eq(schema.customerDiscounts.id, id), eq(schema.customerDiscounts.active, true)));
  await db.insert(schema.auditLog).values({ userId: owner.userId, action: "discount.turned_off", entityType: "customer_discount", entityId: String(id) });
  revalidatePath("/admin/discounts");
  return back("Turned off.");
}
