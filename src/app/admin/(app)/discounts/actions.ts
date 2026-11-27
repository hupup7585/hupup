"use server";

import { and, eq, gte, sql } from "drizzle-orm";
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
  // Extra check F9 (Nov 27, 2026): a double click saves one discount. Under a lock on the phone, the same discount
  // saved for this phone in the last 2 minutes and still on is not added again.
  const added = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"discount:" + d.phone}))`);
    const recent = await tx
      .select()
      .from(schema.customerDiscounts)
      .where(and(eq(schema.customerDiscounts.phone, d.phone), eq(schema.customerDiscounts.active, true), gte(schema.customerDiscounts.createdAt, new Date(Date.now() - 120_000))));
    const same = recent.find((r) => r.kind === d.kind && (r.amountCents ?? null) === d.amountCents && (r.percent === null ? null : Number(r.percent)) === d.percent && (r.endsOn ?? null) === d.endsOn && r.note === d.note);
    if (same) return null;
    const [row] = await tx.insert(schema.customerDiscounts).values({ ...d, percent: d.percent === null ? null : String(d.percent), createdBy: owner.userId }).returning();
    return row;
  });
  if (added) await db.insert(schema.auditLog).values({ userId: owner.userId, action: "discount.added", entityType: "customer_discount", entityId: String(added.id), after: d });
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
