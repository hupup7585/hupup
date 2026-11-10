"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireOwner, requireStaff } from "@/lib/auth";

/** Edit a customer's details (Owner and Secretary). Consent is never edited here: it has its own recorded flow. */
export async function saveCustomerAction(form: FormData) {
  const s = await requireStaff(["owner", "secretary"]);
  const id = Number(form.get("id"));
  const clean = (k: string, max: number) => String(form.get(k) || "").trim().slice(0, max) || null;
  const email = clean("email", 200);
  const after = {
    name: clean("name", 120),
    email: email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null,
    address: clean("address", 300),
    notes: clean("notes", 2000),
  };
  const [before] = await db
    .select({ name: schema.customers.name, email: schema.customers.email, address: schema.customers.address, notes: schema.customers.notes })
    .from(schema.customers)
    .where(eq(schema.customers.id, id))
    .limit(1);
  if (!before) return;
  await db.update(schema.customers).set(after).where(eq(schema.customers.id, id));
  await db.insert(schema.auditLog).values({ userId: s.userId, action: "customer.updated", entityType: "customer", entityId: String(id), before, after });
  revalidatePath(`/admin/customers/${id}`);
  revalidatePath("/admin/customers");
}

/** Owner: mark a customer as a test entry (or not). Nothing is deleted; test entries are left out of campaigns. */
export async function setTestEntryAction(form: FormData) {
  const s = await requireOwner();
  const id = Number(form.get("id"));
  const isTest = form.get("isTest") === "1";
  const [before] = await db.select({ isTest: schema.customers.isTest }).from(schema.customers).where(eq(schema.customers.id, id)).limit(1);
  if (!before) return;
  await db.update(schema.customers).set({ isTest }).where(eq(schema.customers.id, id));
  await db.insert(schema.auditLog).values({ userId: s.userId, action: isTest ? "customer.marked_test" : "customer.unmarked_test", entityType: "customer", entityId: String(id), before, after: { isTest } });
  revalidatePath(`/admin/customers/${id}`);
  revalidatePath("/admin/customers");
}
