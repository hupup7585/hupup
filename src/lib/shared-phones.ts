import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { BUSINESS_NAME, config } from "@/lib/config";
import { formatPhone, toE164 } from "@/lib/phone";
import { sendEmail, sendSms } from "@/lib/notify";
import { spokenLongDate } from "@/lib/dates";
import { textingActive } from "@/lib/voicemail";

/**
 * Phone numbers two directory entries share (Abraham, Nov 22, 2026): 845-238-2784 (Rosner, Usher, 29-001 Dallas Drive
 * and Kleinman, Shimon, 380 Lake Shore Drive, both Monroe, NY 10950). Every order from one of these numbers alerts
 * Abraham right away by email and by text.
 */
export const SHARED_PHONES: readonly string[] = ["+18452382784"];

export function isSharedPhone(phone: string | null | undefined): boolean {
  const e = phone ? toE164(phone) : null;
  return Boolean(e && SHARED_PHONES.includes(e));
}

/** The alert: name, the address chosen, the items and the date(s). Email always; a text once texting is active. */
export async function alertSharedPhoneOrder(input: { phone: string | null; name: string | null; address: string | null; orderIds: number[]; source: "phone" | "staff" | "website" }) {
  if (!input.phone || !isSharedPhone(input.phone) || !input.orderIds.length) return { sent: 0 };
  const phone = input.phone;
  const rows = await db
    .select({ date: schema.orders.eventDate, qty: schema.orderItems.qty, item: schema.products.name })
    .from(schema.orderItems)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.orderItems.orderId))
    .innerJoin(schema.products, eq(schema.products.id, schema.orderItems.productId))
    .where(inArray(schema.orders.id, input.orderIds))
    .orderBy(schema.orders.eventDate, schema.orderItems.id);
  const byDate = new Map<string, string[]>();
  for (const r of rows) byDate.set(r.date, [...(byDate.get(r.date) ?? []), `${r.qty} ${r.item}`]);
  const how = input.source === "phone" ? "the hotline" : input.source === "staff" ? "staff New booking" : "the website";
  const who = input.name?.trim() || "(no name given)";
  const dates = [...byDate.entries()].map(([d, items]) => `${spokenLongDate(d)}: ${items.join(", ")}`);
  const subject = `Order from the shared number ${formatPhone(phone)}: ${who}`;
  const body = [
    `An order came in from ${formatPhone(phone)}, a number two directory entries share, through ${how}.`,
    "",
    `Name: ${who}`,
    `Address chosen: ${input.address?.trim() || "(no address yet)"}`,
    ...dates.map((d) => `Date and items: ${d}`),
    "",
    `Orders: ${config.baseUrl()}/admin/orders`,
  ].join("\n");
  let sent = 0;
  if (config.adminEmail() && (await sendEmail(config.adminEmail(), subject, body)).sent) sent++;
  if (config.adminPhone() && textingActive()) {
    const text = `${BUSINESS_NAME}: order from the shared number ${formatPhone(phone)}. ${who}, ${input.address?.trim() || "no address yet"}. ${dates.join("; ")}.`;
    if ((await sendSms(config.adminPhone(), text, { kind: "system", event: "owner_alert" })).sent) sent++;
  }
  return { sent };
}
