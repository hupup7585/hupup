import { and, desc, eq, inArray } from "drizzle-orm";
import { schema } from "@/lib/db";
import type { Exec } from "@/lib/sms-consent";

/*
 * JOIN reply to the catalog text (Abraham, Nov 27, 2026, 1:52 AM). A number that got the catalog text and replies
 * JOIN (any case, any spaces) is signed up for seasonal offers, with a consent record. Never after a STOP that has no
 * later START; never twice. The promo limit (PROMOS_PER_YEAR = 5 a year) applies like any other promo sign-up.
 */
export const CATALOG_JOIN_SOURCE = "catalog text JOIN reply";
/** The invite line in the catalog text, word for word (Abraham's wording); saved with every record. */
export const CATALOG_JOIN_INVITE = "To join our seasonal offers, reply JOIN. You will never miss a deal, special, or new rentals, up to 5 messages a year.";
export const CATALOG_JOIN_VERSION = "catalog-join-2026-11-27";

/** The confirmation reply is NOT approved yet: built and switched OFF (decision for Abraham). */
export const CATALOG_JOIN_CONFIRM_ON = false;
export const CATALOG_JOIN_CONFIRM_DRAFT = "Hup Up Attractions: You're signed up for our seasonal offers, up to 5 messages a year. Msg & data rates may apply. Reply STOP to opt out, HELP for help.";

/** Did this number get the catalog by text? (key 8, the website, or a CATALOG reply all log "catalog_reply") */
export async function gotCatalogText(exec: Exec, phone: string): Promise<boolean> {
  const [m] = await exec
    .select({ id: schema.messages.id })
    .from(schema.messages)
    .where(and(eq(schema.messages.toNumber, phone), eq(schema.messages.event, "catalog_reply")))
    .limit(1);
  return Boolean(m);
}

/** STOP with no START after it (the latest of the two keywords this number texted is STOP). */
async function stoppedWithoutStart(exec: Exec, phone: string, optedOut: boolean): Promise<boolean> {
  const [last] = await exec
    .select({ event: schema.messages.event })
    .from(schema.messages)
    .where(and(eq(schema.messages.fromNumber, phone), eq(schema.messages.direction, "in"), inArray(schema.messages.event, ["keyword_stop", "keyword_start"])))
    .orderBy(desc(schema.messages.createdAt), desc(schema.messages.id))
    .limit(1);
  if (last) return last.event === "keyword_stop";
  return optedOut; // a STOP from before message logging (or Twilio's own block)
}

/**
 * Signs the number up (inside the caller's locked transaction). Returns what happened; `sendConfirmation` is true
 * only when the confirmation reply is switched on.
 */
export async function catalogJoin(tx: Exec, c: { id: number; smsOptOut: boolean; marketingOptIn: boolean }, phone: string, text: string): Promise<{ result: "joined" | "already" | "stopped"; sendConfirmation: boolean }> {
  if (await stoppedWithoutStart(tx, phone, c.smsOptOut)) return { result: "stopped", sendConfirmation: false };
  const [dup] = await tx
    .select({ id: schema.smsConsents.id })
    .from(schema.smsConsents)
    .where(and(eq(schema.smsConsents.phone, phone), eq(schema.smsConsents.scope, "marketing"), eq(schema.smsConsents.source, CATALOG_JOIN_SOURCE), eq(schema.smsConsents.action, "opt_in")))
    .limit(1);
  if (dup || c.marketingOptIn) return { result: "already", sendConfirmation: false };
  await tx.insert(schema.smsConsents).values({
    customerId: c.id,
    phone,
    scope: "marketing",
    action: "opt_in",
    source: CATALOG_JOIN_SOURCE,
    method: "keyword",
    keyword: "JOIN",
    wording: CATALOG_JOIN_INVITE,
    wordingVersion: CATALOG_JOIN_VERSION,
    response: text.trim().slice(0, 160),
  });
  await tx.update(schema.customers).set({ marketingOptIn: true, marketingOptInAt: new Date() }).where(eq(schema.customers.id, c.id));
  return { result: "joined", sendConfirmation: CATALOG_JOIN_CONFIRM_ON };
}
