"use server";

import { headers } from "next/headers";
import { and, eq, gt, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { config } from "@/lib/config";
import { toE164 } from "@/lib/phone";
import { sendMessage } from "@/lib/sms";
import { MARKETING_CONFIRMATION_SMS, TRANSACTIONAL_CONFIRMATION_SMS, recordConsent, setCustomerTimeZone } from "@/lib/sms-consent";
import { isSelectableTimeZone } from "@/lib/area-code-tz";
import { smsTermsV2Active, webConsentCopy } from "@/lib/sms-terms-v2";
import { requestPromoByCustomer } from "@/lib/sms-reenroll";

export type SignUpState = { ok?: boolean; error?: string; stopped?: boolean; promo?: boolean; orders?: boolean };

const MAX_PER_PHONE_PER_DAY = 6; // 3 sign-ups x 2 boxes
const MAX_PER_IP_PER_DAY = 20;

/** Preview builds share the production database: never create real consent records from the preview site. */
export async function signUpsDisabledReason(): Promise<string | null> {
  if (process.env.VERCEL_ENV === "preview" && process.env.ALLOW_PREVIEW_DB_WRITES !== "1") {
    return "This is the preview site, so sign-ups are turned off here and no consent is recorded.";
  }
  return null;
}

export async function signUpForTexts(_prev: SignUpState, form: FormData): Promise<SignUpState> {
  if (String(form.get("company") || "")) return { ok: true }; // honeypot: bots fill hidden fields
  const phone = toE164(String(form.get("phone") || ""));
  if (!phone) return { error: "Please enter a valid 10-digit US or Canadian mobile number." };
  const orders = form.get("transactional") === "on";
  const promo = form.get("marketing") === "on";
  if (!orders && !promo) return { error: "Please check at least one box to sign up." };
  const timeZone = String(form.get("timeZone") || "");
  // SMS v3: the time zone is optional (without it, promos go out only when both the area-code zone and Eastern Time allow)
  if (promo && !smsTermsV2Active() && !isSelectableTimeZone(timeZone)) return { error: "Please choose your time zone so we only send promotional texts at reasonable hours." };

  const disabled = await signUpsDisabledReason();
  if (disabled) return { error: disabled };

  const h = await headers();
  const ip = (h.get("x-forwarded-for") || "").split(",")[0].trim() || h.get("x-real-ip") || null;
  const userAgent = h.get("user-agent")?.slice(0, 500) ?? null;
  const pageUrl = `${config.baseUrl()}/text-alerts`;

  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const count = async (cond: ReturnType<typeof eq>) =>
    Number(
      (
        await db
          .select({ n: sql<number>`count(*)` })
          .from(schema.smsConsents)
          .where(and(eq(schema.smsConsents.source, "web"), gt(schema.smsConsents.createdAt, since), cond))
      )[0]?.n ?? 0,
    );
  if ((await count(eq(schema.smsConsents.phone, phone))) >= MAX_PER_PHONE_PER_DAY || (ip && (await count(eq(schema.smsConsents.ip, ip))) >= MAX_PER_IP_PER_DAY)) {
    return { error: "Too many sign-ups right now. Please try again tomorrow or call us." };
  }

  const [customer] = await db.select().from(schema.customers).where(eq(schema.customers.phone, phone)).limit(1);
  if (customer?.smsOptOut) return { stopped: true };

  const copy = webConsentCopy();
  const base = { phone, source: "web" as const, method: "checkbox" as const, wordingVersion: copy.version, response: "checked", ip, userAgent, pageUrl };
  let customerId = customer?.id;
  if (orders) customerId = await recordConsent({ ...base, scope: "transactional", action: "opt_in", wording: copy.transactional });
  // SMS v3: the promo box only requests the confirmation text; YES within 24 hours signs up.
  const v3 = smsTermsV2Active();
  if (promo && !v3) customerId = await recordConsent({ ...base, scope: "marketing", action: "opt_in", wording: copy.marketing });

  if (isSelectableTimeZone(timeZone)) await setCustomerTimeZone(phone, timeZone, "web_form");

  const firstName = String(form.get("firstName") || "").trim().slice(0, 60);
  if (firstName && customerId && !customer?.name) await db.update(schema.customers).set({ name: firstName }).where(eq(schema.customers.id, customerId));

  // One confirmation text per program joined (non-promotional).
  if (orders) await sendMessage({ to: phone, body: TRANSACTIONAL_CONFIRMATION_SMS, kind: "system", event: "consent_confirmation", customerId });
  if (promo && !v3) await sendMessage({ to: phone, body: MARKETING_CONFIRMATION_SMS, kind: "system", event: "consent_confirmation", customerId });
  if (promo && v3) await requestPromoByCustomer(phone, `website /text-alerts box (wording ${copy.version}: "${copy.marketing}"), IP ${ip ?? "unknown"}`);
  return { ok: true, orders, promo };
}
