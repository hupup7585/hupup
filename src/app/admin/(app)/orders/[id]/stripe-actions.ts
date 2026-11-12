"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { parseMoneyToCents } from "@/lib/money";
import { refundOrder, sendDisputeEvidence } from "@/lib/stripe-ops";

type R = { ok: boolean; message: string };

/** Refund full or part of a Stripe phone payment (Owner only; the button asks to confirm first). */
export async function refundAction(orderId: number, kind: "full" | "part", amount: string): Promise<R> {
  const s = await requireOwner();
  const cents = kind === "full" ? "full" : parseMoneyToCents(amount);
  if (cents === null) return { ok: false, message: "Enter the amount to refund." };
  try {
    const r = await refundOrder(orderId, cents, s.userId);
    revalidatePath(`/admin/orders/${orderId}`);
    return r.status === "failed" ? { ok: false, message: "Stripe refused the refund. Nothing was refunded." } : { ok: true, message: `Refunded $${(r.amountCents / 100).toFixed(2)}.` };
  } catch (e) {
    revalidatePath(`/admin/orders/${orderId}`);
    return { ok: false, message: (e as Error).message };
  }
}

export async function disputeEvidenceAction(orderId: number, disputeRowId: number): Promise<R> {
  const s = await requireOwner();
  try {
    await sendDisputeEvidence(disputeRowId, s.userId);
    revalidatePath(`/admin/orders/${orderId}`);
    return { ok: true, message: "Proof sent to Stripe." };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
