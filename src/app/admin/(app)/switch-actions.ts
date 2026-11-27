"use server";

import { requireOwner } from "@/lib/auth";
import { requestSwitchCode, type SensitiveSwitch } from "@/lib/switch-guard";

/** Owner only: send a fresh code for turning on one sensitive switch (Hark's review item 9). */
export async function requestSwitchCodeAction(sw: SensitiveSwitch) {
  const o = await requireOwner();
  return requestSwitchCode(o.userId ?? null, sw);
}
