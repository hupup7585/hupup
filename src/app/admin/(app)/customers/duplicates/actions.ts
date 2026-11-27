"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { msgQuery } from "@/lib/url-message";

/** Merge one group (Owner only; runs only when the Owner presses Merge and confirms). */
export async function mergeGroupAction(form: FormData) {
  const owner = await requireOwner();
  if (form.get("confirm") !== "yes") redirect(`/admin/customers/duplicates?${msgQuery("Tick the box to confirm the merge first.")}`);
  const keepId = Number(form.get("keepId"));
  const ids = String(form.get("ids") ?? "").split("-").map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (!keepId || !ids.includes(keepId)) redirect(`/admin/customers/duplicates?${msgQuery("Choose which record to keep.")}`);
  const { mergeCustomers } = await import("@/lib/duplicate-customers");
  const r = await mergeCustomers(keepId, ids, owner.userId);
  revalidatePath("/admin/customers");
  redirect(`/admin/customers/duplicates?${msgQuery(`Merged. ${r.moved} orders, texts and other items moved to the kept record. Nothing was deleted.`)}`);
}
