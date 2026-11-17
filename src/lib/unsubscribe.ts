import { db, schema } from "@/lib/db";
import { verifyUnsubscribe } from "@/lib/signed-link";

/** Wording on the unsubscribe page: a draft until Abraham approves it (promo emails are not sent yet). */
export const UNSUBSCRIBE_TEXT = {
  title: "Unsubscribe from promotional emails",
  ask: "Press the button to stop promotional emails from Hup Up Attractions. Booking and payment emails still come to you.",
  button: "Unsubscribe",
  done: "You are unsubscribed from Hup Up Attractions promotional emails.",
  bad: "This link is not valid.",
};

/** Record the unsubscribe (signed link only). True when it is done. */
export async function unsubscribe(email: string | null, sig: string | null): Promise<boolean> {
  if (!verifyUnsubscribe(email, sig)) return false;
  await db.insert(schema.emailUnsubscribes).values({ email: email!.toLowerCase() }).onConflictDoNothing();
  return true;
}
