"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner, requireStaff } from "@/lib/auth";
import { approveCampaign, cancelCampaign, createCampaign, sendCampaign } from "@/lib/campaigns";

const back = (msg: string, err = false): never => redirect(`/admin/campaigns?${err ? "err" : "msg"}=${encodeURIComponent(msg)}`);
const fail = (e: unknown) => back((e as Error).message || "Something went wrong.", true);

/** Owner: write a new campaign (draft). */
export async function createCampaignAction(form: FormData) {
  const s = await requireOwner();
  try {
    await createCampaign({ name: String(form.get("name") ?? ""), body: String(form.get("body") ?? "") }, s.userId);
  } catch (e) {
    fail(e);
  }
  revalidatePath("/admin/campaigns");
  back("Draft saved. Approve the wording when it's ready.");
}

/** Owner: approve the wording (then the Owner or the Secretary can send it). */
export async function approveCampaignAction(form: FormData) {
  const s = await requireOwner();
  try {
    await approveCampaign(Number(form.get("id")), s.userId);
  } catch (e) {
    fail(e);
  }
  revalidatePath("/admin/campaigns");
  back("Approved. It can be sent now.");
}

/** Owner: cancel a campaign that hasn't been sent. */
export async function cancelCampaignAction(form: FormData) {
  const s = await requireOwner();
  try {
    await cancelCampaign(Number(form.get("id")), s.userId);
  } catch (e) {
    fail(e);
  }
  revalidatePath("/admin/campaigns");
  back("Canceled.");
}

/** Owner or Secretary: send an approved campaign to eligible customers only. */
export async function sendCampaignAction(form: FormData) {
  const s = await requireStaff(["owner", "secretary"]);
  let msg = "";
  try {
    const c = await sendCampaign(Number(form.get("id")), s.userId);
    msg = `Sent to ${c.sentCount ?? 0}. ${c.heldCount ? `${c.heldCount} will go out at 8 AM their time. ` : ""}${c.skippedCount ? `${c.skippedCount} skipped (not eligible).` : ""}`.trim();
  } catch (e) {
    fail(e);
  }
  revalidatePath("/admin/campaigns");
  back(msg);
}
