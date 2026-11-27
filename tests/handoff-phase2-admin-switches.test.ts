import { describe, expect, it, vi } from "vitest";

/* Admin handoff Phase 2, Admin and Bookkeeping part (Nov 27, 2026): live refunds, invoice email and the staff promo
   Preview mark were set in code; now Owner settings, each starting at exactly today's value, explained, and live
   refunds behind the safety check. */
const who = vi.hoisted(() => ({ role: "owner" as "owner" | "secretary" }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error(`REDIRECT ${decodeURIComponent(u)}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), currentStaff: async () => ({ userId: null, role: who.role }) }));

import { getSettings, saveSetting, SETTING_DEFAULTS } from "@/lib/settings";
import { LIVE_REFUNDS_APPROVED, liveRefundsOn } from "@/lib/refunds";
import { INVOICE_EMAIL_APPROVED, invoiceEmailOn } from "@/lib/invoice-share";
import { STAFF_PROMO_MODE } from "@/lib/staff-promo";
import { CONFIG_EXPLANATIONS } from "@/lib/config-explanations";
import { featureSwitches } from "@/lib/feature-switches";
import { SENSITIVE_SWITCHES } from "@/lib/switch-guard";
import * as A from "@/app/admin/(app)/bookkeeping/actions";

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const act = async (p: Promise<unknown>) => {
  try {
    await p;
    return "";
  } catch (e) {
    return String((e as Error).message);
  }
};

describe("Phase 2: Admin switches once set in code", () => {
  it("each starts at exactly today's value and is explained in plain English", async () => {
    expect(SETTING_DEFAULTS.liveRefundsOn).toBe(LIVE_REFUNDS_APPROVED);
    expect(SETTING_DEFAULTS.invoiceEmailOn).toBe(INVOICE_EMAIL_APPROVED);
    expect(SETTING_DEFAULTS.staffPromoMode).toBe(STAFF_PROMO_MODE);
    expect(await liveRefundsOn()).toBe(false);
    expect(await invoiceEmailOn()).toBe(true);
    for (const k of ["liveRefundsOn", "invoiceEmailOn", "staffPromoMode"]) {
      const e = CONFIG_EXPLANATIONS[k];
      expect(e?.what && e.where && e.ifChanged).toBeTruthy();
    }
    const list = featureSwitches(await getSettings() as never);
    for (const id of ["live_refunds", "invoice_email", "staff_promo"]) expect(list.find((x) => x.id === id)?.settingKey).toBeTruthy();
  });

  it("live refunds: Owner only; with the safety check on, turning it on needs the code; off never does", async () => {
    expect(SENSITIVE_SWITCHES.liveRefundsOn.phrase).toBe("TURN ON LIVE REFUNDS");
    who.role = "secretary";
    // a Secretary is sent away (and one given Bookkeeping is refused by the Owner check in the action)
    expect(await act(A.saveRefundSwitchesAction(form({ liveRefundsOn: "on", invoiceEmailOn: "on" })))).toMatch(/Only the Owner|REDIRECT \/admin$/);
    expect(await liveRefundsOn()).toBe(false);
    who.role = "owner";
    await saveSetting("sensitiveSwitchGuard", true);
    expect(await act(A.saveRefundSwitchesAction(form({ liveRefundsOn: "on", invoiceEmailOn: "on" })))).toMatch(/Not saved/);
    expect(await liveRefundsOn()).toBe(false);
    await saveSetting("sensitiveSwitchGuard", false);
    expect(await act(A.saveRefundSwitchesAction(form({ liveRefundsOn: "on", invoiceEmailOn: "on" })))).toMatch(/Live refunds: on/);
    expect(await liveRefundsOn()).toBe(true);
    await saveSetting("sensitiveSwitchGuard", true);
    expect(await act(A.saveRefundSwitchesAction(form({ invoiceEmailOn: "on" })))).toMatch(/Live refunds: off/); // off: no code
    expect(await liveRefundsOn()).toBe(false);
  });

  it("invoice email off: the action says so (the button still answers)", async () => {
    who.role = "owner";
    await saveSetting("invoiceEmailOn", false);
    expect(await invoiceEmailOn()).toBe(false);
    const I = await import("@/app/admin/(app)/bookkeeping/invoice-actions");
    expect(await act(I.emailDocAction(form({ id: "1" })))).toMatch(/turned off/);
  });
});
