import { and, eq, inArray, lte, ne } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getSettings } from "@/lib/settings";

/*
 * Address check with two backups, re-check and Owner text (Abraham, Nov 27, 2026, 2:02-2:12 AM ET).
 *
 * At booking, when no map service could place the house (main service and both free backups failed), the customer is
 * not blocked: the delivery price comes from the town they gave, and the order is marked "Address not confirmed yet"
 * (red on the order, the delivery list and the driver screen). The address is then checked again automatically: every
 * 15 minutes for the first hour, then every hour (both editable in Delivery settings), until it is confirmed, or the
 * order is cancelled or delivered. When a check confirms the house in the zone the customer paid for, the mark clears
 * quietly. The Owner gets ONE text per order per problem (not confirmed after the first hour; the address does not
 * exist; the house is in a different zone or outside the county). Nothing is charged, refunded or cancelled.
 * No staff texts during Shabbes or Yom Tov: they wait and go out right after.
 */

export type CheckRow = typeof schema.addressChecks.$inferSelect;
type Kind = "local" | "area" | "outside";

const DONE = ["CANCELLED", "DELIVERED", "PICKED_UP"];
const KIND_NAME: Record<Kind, string> = { local: "Kiryas Joel zone", area: "nearby towns zone", outside: "rest of Orange County zone" };
const norm = (a: string) => a.trim().replace(/\s+/g, " ").toLowerCase();
const num = (v: unknown, d: number, min: number, max: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : d;
};

/** The re-check timing from Delivery settings (minutes). */
export function recheckTiming(s: Record<string, unknown>) {
  return { early: num(s.addressRecheckEarlyMinutes, 15, 5, 120), earlyFor: num(s.addressRecheckEarlyForMinutes, 60, 0, 24 * 60), later: num(s.addressRecheckLaterMinutes, 60, 15, 24 * 60) };
}

/** When the next check is due: every `early` minutes until `earlyFor` minutes after the booking, then every `later`. */
export function nextCheckAt(firstAt: Date, now: Date, s: Record<string, unknown>): Date {
  const { early, earlyFor, later } = recheckTiming(s);
  const since = (now.getTime() - firstAt.getTime()) / 60_000;
  if (since < earlyFor) {
    const k = Math.floor(since / early) + 1;
    const at = k * early;
    if (at <= earlyFor) return new Date(firstAt.getTime() + at * 60_000);
  }
  return new Date(now.getTime() + later * 60_000);
}

/**
 * After an order's delivery is priced: which service placed the house, and the "not confirmed" mark when only the town
 * gave the price. No map lookup here (the price step already did it): the saved list of found houses decides.
 */
export async function noteAddressCheck(orderId: number, now = new Date()): Promise<void> {
  try {
    const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
    if (!o?.deliveryAddress?.trim() || DONE.includes(o.status)) return;
    const s = (await getSettings()) as Record<string, unknown>;
    const [hit] = await db.select().from(schema.geocodeCache).where(eq(schema.geocodeCache.address, norm(o.deliveryAddress))).limit(1);
    const [row] = await db.select().from(schema.addressChecks).where(eq(schema.addressChecks.orderId, orderId)).limit(1);
    if (hit && hit.lat !== null && hit.lng !== null) {
      await db.update(schema.orders).set({ addressSource: hit.source }).where(eq(schema.orders.id, orderId));
      // the address was changed to one the map knows: the old mark is gone
      if (row && norm(row.address) !== norm(o.deliveryAddress)) await db.update(schema.addressChecks).set({ status: "confirmed", source: hit.source, problem: null, problemKind: null, updatedAt: now }).where(eq(schema.addressChecks.orderId, orderId));
      return;
    }
    const { townQuote } = await import("@/lib/delivery-areas");
    const t = townQuote(o.deliveryAddress, s as never);
    const paidKind = t && t.ok ? t.kind ?? null : null;
    await db.update(schema.orders).set({ addressSource: "town" }).where(eq(schema.orders.id, orderId));
    if (row && norm(row.address) === norm(o.deliveryAddress) && row.status !== "confirmed") return; // already being checked
    const values = { address: o.deliveryAddress, status: "unconfirmed", problemKind: null, problem: null, source: "town", paidKind, paidZone: o.deliveryZone, tries: 0, firstAt: now, lastAt: null, nextAt: nextCheckAt(now, now, s), updatedAt: now };
    if (row) await db.update(schema.addressChecks).set(values).where(eq(schema.addressChecks.orderId, orderId));
    else await db.insert(schema.addressChecks).values({ orderId, ...values, alerts: [] }).onConflictDoNothing();
    await armRechecks(values.nextAt);
  } catch (e) {
    console.error("[address check] note failed", orderId, (e as Error).message);
  }
}

/** Plain words for staff (order page, delivery list, driver screen). */
export function markText(r: Pick<CheckRow, "status" | "problem">): string | null {
  if (r.status === "unconfirmed") return "Address not confirmed yet";
  if (r.status === "problem") return r.problem || "Address problem";
  return null;
}

/** The red marks for a list of orders (orderId -> words). */
export async function addressMarks(orderIds: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (!orderIds.length) return out;
  const rows = await db.select().from(schema.addressChecks).where(and(inArray(schema.addressChecks.orderId, orderIds), inArray(schema.addressChecks.status, ["unconfirmed", "problem"])));
  for (const r of rows) {
    const t = markText(r);
    if (t) out.set(r.orderId, t);
  }
  return out;
}

/* ---- the re-check job ---- */

export type CheckDeps = { fetcher?: typeof fetch; now?: Date; send?: (to: string, body: string) => Promise<{ sent: boolean }> };

const fmtMoney = (c: number) => `$${(c / 100).toFixed(2)}`;
const fmtDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" });

/** The Owner text, word for word as Abraham asked. */
export async function problemText(o: typeof schema.orders.$inferSelect, problem: string): Promise<string> {
  const { orderNumber } = await import("@/lib/orders");
  const { formatPhone } = await import("@/lib/phone");
  const [c] = o.customerId ? await db.select().from(schema.customers).where(eq(schema.customers.id, o.customerId)).limit(1) : [];
  return `Hup Up order problem: ${problem}. Order ${orderNumber(o.id)}, ${c?.name || "no name"}, ${c?.phone ? formatPhone(c.phone) : "no phone"}, ${o.deliveryAddress ?? ""}, delivery ${fmtDay(o.eventDate)}, delivery charged ${fmtMoney(o.deliveryFeeCents)}.`;
}

async function ownerPhones(): Promise<string[]> {
  const { mainBox } = await import("@/lib/voicemail");
  return (await mainBox()).notifySms;
}

async function defaultSend(to: string, body: string) {
  const { sendSms } = await import("@/lib/notify");
  return sendSms(to, body, { kind: "system", event: "owner_alert" });
}

/** Queue a text for this problem (once per order per problem) and send what may go out now. */
async function alertOnce(row: CheckRow, o: typeof schema.orders.$inferSelect, key: string, problem: string, deps: CheckDeps): Promise<CheckRow["alerts"]> {
  const alerts = [...(row.alerts ?? [])];
  if (!alerts.some((a) => a.key === key)) alerts.push({ key, text: await problemText(o, problem), sentAt: null });
  return sendWaiting(alerts, deps);
}

/** Sends waiting texts unless it is Shabbes or Yom Tov now (then they go out on the first run after). */
async function sendWaiting(alerts: CheckRow["alerts"], deps: CheckDeps): Promise<CheckRow["alerts"]> {
  const now = deps.now ?? new Date();
  if (!alerts.some((a) => !a.sentAt)) return alerts;
  const { bookingLock } = await import("@/lib/jewish-calendar");
  const s = await getSettings();
  if (bookingLock(now, s as never).locked) return alerts;
  const phones = await ownerPhones();
  const send = deps.send ?? defaultSend;
  const out = [];
  for (const a of alerts) {
    if (a.sentAt) {
      out.push(a);
      continue;
    }
    let ok = false;
    for (const p of phones) if ((await send(p, a.text).catch(() => ({ sent: false }))).sent) ok = true;
    out.push(ok ? { ...a, sentAt: now.toISOString() } : a);
  }
  return out;
}

/** One check of one order's address. */
async function checkOne(row: CheckRow, deps: CheckDeps) {
  const now = deps.now ?? new Date();
  const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, row.orderId)).limit(1);
  if (!o || DONE.includes(o.status) || !o.deliveryAddress) {
    await db.update(schema.addressChecks).set({ status: "stopped", updatedAt: now }).where(eq(schema.addressChecks.orderId, row.orderId));
    return;
  }
  const s = (await getSettings()) as Record<string, unknown>;
  const on = (v: unknown) => v !== false && v !== "false";
  const { geocodeDetail, deliveryQuote } = await import("@/lib/delivery-areas");
  const look = await geocodeDetail(o.deliveryAddress, deps.fetcher ?? fetch, { census: on(s.geoBackupCensusOn), osm: on(s.geoBackupOsmOn), fresh: true });
  const tries = row.tries + 1;
  let patch: Partial<CheckRow> = { tries, lastAt: now, updatedAt: now, nextAt: nextCheckAt(row.firstAt, now, s) };
  const paid = row.paidZone || o.deliveryZone || (row.paidKind ? KIND_NAME[row.paidKind as Kind] : "the zone on the order");
  if (look.found) {
    const q = await deliveryQuote(o.deliveryAddress, s as never, deps.fetcher ?? fetch, o.eventDate);
    await db.update(schema.orders).set({ addressSource: look.found.source }).where(eq(schema.orders.id, o.id));
    if (q.ok && (!row.paidKind || q.kind === row.paidKind)) {
      // confirmed in the zone the customer paid for: the mark clears quietly
      await db.update(schema.addressChecks).set({ ...patch, status: "confirmed", source: look.found.source, problem: null, problemKind: null }).where(eq(schema.addressChecks.orderId, o.id));
      return;
    }
    const real = q.ok ? (q.kind ? KIND_NAME[q.kind] : q.zone) : "outside Orange County (outside our delivery area)";
    const problem = `Address is in ${real}, customer paid for ${paid}`;
    const key = `zone:${q.ok ? q.kind : "outside_county"}`;
    patch = { ...patch, status: "problem", problemKind: "zone", problem, source: look.found.source, alerts: await alertOnce(row, o, key, problem, deps) };
  } else if (look.allAnswered) {
    const problem = "Address does not exist";
    patch = { ...patch, status: "problem", problemKind: "not_exist", problem, alerts: await alertOnce(row, o, "not_exist", problem, deps) };
  } else {
    // the services did not answer: still not confirmed; after the first hour (4 tries) the Owner hears about it once
    const { earlyFor } = recheckTiming(s);
    const late = (now.getTime() - row.firstAt.getTime()) / 60_000 >= earlyFor;
    if (late && row.status === "unconfirmed") {
      patch = { ...patch, alerts: await alertOnce(row, o, "not_confirmed_1h", "Address not confirmed after 1 hour", deps) };
    } else patch = { ...patch, alerts: await sendWaiting(row.alerts ?? [], deps) };
  }
  await db.update(schema.addressChecks).set(patch).where(eq(schema.addressChecks.orderId, o.id));
}

/** The job: every address check that is due. Returns how many are still waiting and when the next one is due. */
export async function runAddressChecks(deps: CheckDeps = {}): Promise<{ checked: number; pending: number; nextAt: Date | null }> {
  const now = deps.now ?? new Date();
  const due = await db.select().from(schema.addressChecks).where(and(inArray(schema.addressChecks.status, ["unconfirmed", "problem"]), lte(schema.addressChecks.nextAt, now)));
  for (const r of due) await checkOne(r, deps).catch((e) => console.error("[address check]", r.orderId, (e as Error).message));
  // texts held for Shabbes on rows that are not due yet
  const held = await db.select().from(schema.addressChecks).where(ne(schema.addressChecks.status, "stopped"));
  for (const r of held) {
    if (!(r.alerts ?? []).some((a) => !a.sentAt)) continue;
    const alerts = await sendWaiting(r.alerts, deps);
    await db.update(schema.addressChecks).set({ alerts }).where(eq(schema.addressChecks.orderId, r.orderId));
  }
  const left = await db.select({ nextAt: schema.addressChecks.nextAt, alerts: schema.addressChecks.alerts }).from(schema.addressChecks).where(inArray(schema.addressChecks.status, ["unconfirmed", "problem"]));
  const nextAt = left.length ? new Date(Math.min(...left.map((r) => r.nextAt.getTime()))) : null;
  await armRechecks(nextAt).catch(() => undefined);
  return { checked: due.length, pending: left.length, nextAt };
}

/* ---- the free timing: see wake-flags.ts (a small file on free Cloudflare R2 says when the next check is due) ---- */

export async function armRechecks(nextAt: Date | null) {
  const { armWake } = await import("@/lib/wake-flags");
  await armWake("address-rechecks", nextAt);
}

/** Is a re-check due now? Read from the small R2 file only (no database). */
export async function recheckDue(now = new Date()): Promise<boolean> {
  const { wakeDue } = await import("@/lib/wake-flags");
  return wakeDue("address-rechecks", now);
}
