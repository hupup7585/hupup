"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { unlockNumber } from "@/lib/phonepay-watch";

/** Owner or secretary: unlock card payment by phone for a number (Abraham, Nov 17, 2026). Logged. */
export async function unlockCardBlockAction(form: FormData) {
  const staff = await requireAdmin();
  const id = Number(form.get("id"));
  if (!id) return;
  await unlockNumber(id, staff.userId);
  await db.insert(schema.auditLog).values({ userId: staff.userId, action: "phonepay.unblocked", entityType: "phonepay_block", entityId: String(id) });
  revalidatePath("/admin/phone/card-blocks");
}
