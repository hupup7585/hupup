import { formatPhone, toE164 } from "@/lib/phone";

/** The hotline that sends our texts and takes STOP/HELP/START (Abraham: (845) 415-7585). */
export const TEXTING_NUMBER_E164 = "+18454157585";

/** The number our texts come from and that customers text STOP/HELP/START to. A blank or placeholder value
 *  (like (845) 000-0000 in a test setup) never reaches a customer: the real hotline is shown instead. */
export function smsNumberDisplay(env: Record<string, string | undefined> = process.env): string {
  const e = toE164(env.TWILIO_PHONE_NUMBER || "");
  const fake = !e || /0000000$/.test(e) || /^\+1\d{3}555\d{4}$/.test(e);
  return formatPhone(fake ? TEXTING_NUMBER_E164 : e);
}
