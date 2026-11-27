"use server";

import { requireOwner } from "@/lib/auth";
import { mergeCustomers, type MergeResult } from "@/lib/duplicate-customers";

/** Owner only: merges one group, only when the Owner presses its Merge button (Hark for Abraham, Nov 27, 2026). */
export async function mergeGroupAction(keepId: number, otherIds: number[]): Promise<MergeResult> {
  const me = await requireOwner();
  const r = await mergeCustomers(Number(keepId), (otherIds ?? []).map(Number), me.userId ?? null);
  if (r.ok) {
    const { revalidatePath } = await import("next/cache");
    revalidatePath("/admin/customers/duplicates");
    revalidatePath("/admin/customers");
  }
  return r;
}
