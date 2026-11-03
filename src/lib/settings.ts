import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { BUSINESS_NAME } from "@/lib/config";

/** Admin-editable settings with defaults. Stored in app_settings (key -> jsonb). */
export const SETTING_DEFAULTS = {
  smsForwardEnabled: true,
  smsForwardPhone: "",
  smsHelpReplyEnabled: false,
  smsHelpText: `${BUSINESS_NAME}: for help call or text us at this number. Reply STOP to opt out.`,
  supportPhone: "",
} as const;

export type Settings = { -readonly [K in keyof typeof SETTING_DEFAULTS]: (typeof SETTING_DEFAULTS)[K] extends boolean ? boolean : string };

export async function getSettings(): Promise<Settings> {
  const out = { ...SETTING_DEFAULTS } as Settings;
  try {
    const rows = await db.select().from(schema.appSettings);
    for (const r of rows) if (r.key in out) (out as Record<string, unknown>)[r.key] = r.value;
  } catch (e) {
    console.error("settings load failed, using defaults", e);
  }
  if (!out.smsForwardPhone) out.smsForwardPhone = process.env.ADMIN_PHONE || "";
  if (!out.supportPhone) out.supportPhone = process.env.TWILIO_PHONE_NUMBER || "";
  return out;
}

export async function saveSetting<K extends keyof Settings>(key: K, value: Settings[K], userId?: number | null) {
  await db
    .insert(schema.appSettings)
    .values({ key, value, updatedBy: userId ?? null })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value, updatedAt: new Date(), updatedBy: userId ?? null } });
}

export async function deleteSetting(key: string) {
  await db.delete(schema.appSettings).where(eq(schema.appSettings.key, key));
}
