"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { confirmAttentionOrder } from "@/lib/late-payment";

/** Owner or Secretary: confirm a late-paid order once its items are free again (re-checked on the server). */
export async function confirmAttentionAction(orderId: number) {
  const s = await requireStaff(["owner", "secretary"]);
  const ok = await confirmAttentionOrder(orderId);
  await db.insert(schema.auditLog).values({ userId: s.userId, action: ok ? "order.attention_confirmed" : "order.attention_still_taken", entityType: "order", entityId: String(orderId) });
  revalidatePath(`/admin/orders/${orderId}`);
}
