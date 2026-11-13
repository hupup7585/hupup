import { PROMPTS, RETIRED_PROMPTS, promptWaiting, type PromptKey, type PromptOverrides } from "@/lib/ivr/prompts";
import { PHONE_PROMO_MODE } from "@/lib/phone-promo";
import { STRIPE_PHONE_PAY_MODE } from "@/lib/phone-pay";
import { SMS_CATALOG_REPLY_ON, infoCatalogAutoreplyOn } from "@/lib/catalog-send";
import { termsActive } from "@/lib/rental-terms";

/** Live, Waiting for approval, Not active yet (with the reason), or Not used (an old line kept for the record). */
export type LineStatus = { status: "Live" | "Waiting for approval" | "Not active yet" | "Not used"; reason?: string };

const TEXTING = "Waits for Twilio to approve texting.";

/** Why a line can't play yet, even when its wording is fine (features that are switched off). */
export function notActiveReason(key: string, env: Record<string, string | undefined> = process.env): string | null {
  if (key.startsWith("promo_") || key === "consent_marketing_v2") return PHONE_PROMO_MODE === "off" ? "Phone promo steps are off until SMS Terms v3 is live and you approve a test recording." : null;
  if (key.startsWith("pay_")) return STRIPE_PHONE_PAY_MODE !== "live" ? "Keypad payment plays only on your own test calls until you approve a real test." : null;
  if (key === "spoken_readback") return "Waits for your OK on speech to text and its price.";
  if (key === "recording_notice") return "Call recording is off.";
  if (key.startsWith("catalog_text") || key === "catalog_texted") return TEXTING;
  if (key === "msg_catalog_text") return SMS_CATALOG_REPLY_ON ? null : "Texting CATALOG and catalog texts wait for Twilio to approve texting.";
  if (key === "catalog_email_info") return infoCatalogAutoreplyOn(env) ? null : "Plays once the info@ Catalog auto-reply is connected (Cloudflare Email Worker).";
  if (key === "terms_notice" || key === "msg_terms_link") return termsActive() ? null : "The Terms step is off on the live site until the final Terms are in.";
  if (key === "instr_balloons" || key === "instr_laser" || key === "instr_paddle") return "Waits for your script.";
  return null;
}

export function lineStatus(key: PromptKey, overrides: PromptOverrides): LineStatus {
  if (RETIRED_PROMPTS.has(key)) return { status: "Not used", reason: "An old line no longer played anywhere (kept for the record)." };
  if (promptWaiting(overrides, key)) return { status: "Waiting for approval", reason: notActiveReason(key) ?? undefined };
  const reason = notActiveReason(key);
  if (reason) return { status: "Not active yet", reason };
  return { status: "Live" };
}

export const ALL_PROMPT_KEYS = Object.keys(PROMPTS) as PromptKey[];
