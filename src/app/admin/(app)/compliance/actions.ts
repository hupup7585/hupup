"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireAdmin } from "@/lib/auth";
import { complianceSnapshot, isOwnerSession, recordComplianceReview, reportComplianceIssue } from "@/lib/compliance";

export type ComplianceResult = { ok: boolean; message: string };

async function who() {
  const h = await headers();
  return { ip: (h.get("x-forwarded-for") || "").split(",")[0].trim() || null, userAgent: h.get("user-agent")?.slice(0, 500) ?? null };
}

/** Any signed-in staff member. The Owner is texted/emailed right away. */
export async function reportIssueAction(description: string): Promise<ComplianceResult> {
  const session = await requireAdmin();
  try {
    await reportComplianceIssue({ userId: session.userId ?? null, description, ...(await who()) });
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  revalidatePath("/admin/compliance");
  return { ok: true, message: "Reported. The owner has been notified." };
}

/** Owner only. */
export async function completeReviewAction(notes: string): Promise<ComplianceResult> {
  const session = await requireAdmin();
  if (!(await isOwnerSession(session.userId))) return { ok: false, message: "Only the owner can record a compliance review." };
  const snap = await complianceSnapshot();
  await recordComplianceReview({ userId: session.userId ?? null, notes, findings: snap.findings.length, ...(await who()) });
  revalidatePath("/admin/compliance");
  return { ok: true, message: "Review recorded." };
}
