"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { UNIT_STATUSES, type UnitStatus } from "@/lib/db/schema";
import { addUnit, setUnitStatus } from "@/lib/units";

const dollars = (v: FormDataEntryValue | null) => {
  const n = Number(String(v ?? "").replace(/[$,\s]/g, ""));
  return String(v ?? "").trim() && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};

export async function addUnitAction(fd: FormData) {
  const staff = await requireAdmin();
  let m: string;
  try {
    const u = await addUnit(
      {
        productId: Number(fd.get("productId")),
        code: String(fd.get("code") ?? ""),
        serial: String(fd.get("serial") ?? ""),
        model: String(fd.get("model") ?? ""),
        purchaseDate: String(fd.get("purchaseDate") ?? ""),
        purchasePriceCents: dollars(fd.get("purchasePrice")),
        replacementValueCents: dollars(fd.get("replacementValue")),
        condition: String(fd.get("condition") ?? "good"),
        location: String(fd.get("location") ?? ""),
        notes: String(fd.get("notes") ?? ""),
      },
      { userId: staff.userId, role: staff.role },
    );
    m = `Unit ${u.code} added.`;
  } catch (e) {
    m = /unique|duplicate/i.test(String(e)) ? "That unit ID is already used." : (e as Error).message;
  }
  revalidatePath("/admin/units");
  redirect(`/admin/units?m=${encodeURIComponent(m)}`);
}

export async function unitStatusAction(fd: FormData) {
  const staff = await requireAdmin();
  const status = String(fd.get("status")) as UnitStatus;
  let m: string;
  try {
    if (!UNIT_STATUSES.includes(status)) throw new Error("Choose a status.");
    const r = await setUnitStatus(Number(fd.get("unitId")), status, String(fd.get("reason") ?? ""), { userId: staff.userId, role: staff.role });
    m = r.conflicts.length ? `Saved. No other unit is free for: ${r.conflicts.join(", ")}. You were emailed.` : "Saved.";
  } catch (e) {
    m = (e as Error).message;
  }
  revalidatePath("/admin/units");
  redirect(`/admin/units?m=${encodeURIComponent(m)}`);
}
