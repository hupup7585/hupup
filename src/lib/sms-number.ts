import { formatPhone } from "@/lib/phone";

/** The number our texts come from and that customers text STOP/HELP/START to (the Twilio hotline). */
export function smsNumberDisplay(): string {
  return formatPhone(process.env.TWILIO_PHONE_NUMBER || "+18454157585");
}
