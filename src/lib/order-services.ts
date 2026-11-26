import { asc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { taxOn } from "@/lib/pricing";
import { parseMoneyToCents } from "@/lib/money";

/**
 * Custom-amount services on any order (Abraham, Nov 26, 2026, 13:54 ET).
 *
 * The Owner or Secretary adds one or more services to an order in Admin (a phone, website or New booking order, new or
 * old): a name ("Extra setup", "Late pickup fee"), an amount, and an optional note. Each one is its own line, numbered
 * in the order it was added (Service 1, Service 2, ...), and is shown by its name and amount on the order page, the
 * review-and-pay page, the secure card page, the payment link text, the invoice and receipt, and in bookkeeping.
 *
 * Money: a service counts in the order's total and in sales tax like any other charge (taxable by default; staff can
 * untick "Taxable" for one service). The tax is worked out once on everything taxable together (rentals, delivery and
 * the taxable services), so the order shows one sales tax line that is right to the cent.
 *
 * Not inventory: a service never touches the calendar, stock or equipment units.
 *
 * Changes: before any payment, a service can be changed or removed freely. A payment locks every service that was on
 * the order when it was paid (the same rule as the rest of a paid order: its price does not change; money back goes
 * through Refund). A service added after a payment makes a balance due, sent with the usual payment link, and can be
 * changed or removed until that balance is paid.
 */

export type OrderService = typeof schema.orderServices.$inferSelect;
export type ServiceInput = { name: string; amount: string; note?: string; showNoteOnReceipt?: boolean; taxable?: boolean };
export type ServiceSums = { cents: number; taxableCents: number };

export const SERVICE_NAME_MAX = 80;
export const SERVICE_NOTE_MAX = 500;
/** A safety cap per service ($100,000), so a typo with extra zeros is caught */
export const SERVICE_AMOUNT_MAX_CENTS = 10_000_000;

export class ServiceError extends Error {}

/** Checks one service the way staff typed it. Returns the clean values, or the reason in plain words. */
export function parseService(input: ServiceInput): { ok: true; value: { name: string; amountCents: number; note: string | null; showNoteOnReceipt: boolean; taxable: boolean } } | { ok: false; message: string } {
  const name = (input.name ?? "").replace(/\s+/g, " ").trim();
  if (!name) return { ok: false, message: "Write the service name (for example: Extra setup)." };
  if (name.length > SERVICE_NAME_MAX) return { ok: false, message: `The service name can be at most ${SERVICE_NAME_MAX} letters.` };
  const raw = (input.amount ?? "").trim();
  if (!raw) return { ok: false, message: "Write the amount in dollars and cents (for example: 25.00)." };
  if (/^-/.test(raw.replace(/^\$/, ""))) return { ok: false, message: "The amount must be more than $0.00. To give money back, use Refund." };
  if (!/^\$?\s*(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$/.test(raw)) return { ok: false, message: "Write the amount in dollars and cents, numbers only (for example: 25.00)." };
  const amountCents = parseMoneyToCents(raw.replace(/[$,\s]/g, ""));
  if (!amountCents || amountCents <= 0) return { ok: false, message: "The amount must be more than $0.00." };
  if (amountCents > SERVICE_AMOUNT_MAX_CENTS) return { ok: false, message: "That amount is too large for one service. Check the number of zeros." };
  const note = (input.note ?? "").trim();
  if (note.length > SERVICE_NOTE_MAX) return { ok: false, message: `The note can be at most ${SERVICE_NOTE_MAX} letters.` };
  return { ok: true, value: { name, amountCents, note: note || null, showNoteOnReceipt: Boolean(input.showNoteOnReceipt) && Boolean(note), taxable: input.taxable !== false } };
}

export function sumServices(list: Pick<OrderService, "amountCents" | "taxable">[]): ServiceSums {
  return list.reduce((s, x) => ({ cents: s.cents + x.amountCents, taxableCents: s.taxableCents + (x.taxable ? x.amountCents : 0) }), { cents: 0, taxableCents: 0 });
}

/**
 * Adds the services to an order's priced amounts: one sales tax on rentals + delivery + the taxable services, and the
 * total. servicesTaxCents is the part of the tax the services added (so the rentals' own tax can always be found).
 */
export function withServices<T extends { subtotalCents: number; deliveryFeeCents: number; taxPercent: string; taxCents: number; totalCents: number }>(t: T, sums: ServiceSums): T & { servicesCents: number; servicesTaxCents: number } {
  const base = t.subtotalCents + t.deliveryFeeCents;
  const servicesTaxCents = sums.taxableCents ? taxOn(base + sums.taxableCents, t.taxPercent) - taxOn(base, t.taxPercent) : 0;
  return { ...t, servicesCents: sums.cents, servicesTaxCents, taxCents: t.taxCents + servicesTaxCents, totalCents: t.totalCents + sums.cents + servicesTaxCents };
}

type Exec = Pick<typeof db, "select" | "execute" | "update">;

export async function listServices(orderId: number, exec: Pick<typeof db, "select"> = db): Promise<OrderService[]> {
  return exec.select().from(schema.orderServices).where(eq(schema.orderServices.orderId, orderId)).orderBy(asc(schema.orderServices.createdAt), asc(schema.orderServices.id));
}

/** Services for several orders at once (a payment group), by order id, in the order they were added. */
export async function servicesByOrder(orderIds: number[], exec: Pick<typeof db, "select"> = db): Promise<Map<number, OrderService[]>> {
  const m = new Map<number, OrderService[]>(orderIds.map((id) => [id, []]));
  if (!orderIds.length) return m;
  const rows = await exec.select().from(schema.orderServices).where(inArray(schema.orderServices.orderId, orderIds)).orderBy(asc(schema.orderServices.createdAt), asc(schema.orderServices.id));
  for (const r of rows) m.get(r.orderId)?.push(r);
  return m;
}

export async function serviceSumsFor(orderId: number, exec: Pick<typeof db, "select"> = db): Promise<ServiceSums> {
  return sumServices(await listServices(orderId, exec));
}

/**
 * Brings an already priced order's tax and total in step with its services (after one is added, changed or removed).
 * An order that is not priced yet (no total) is priced later with its services included (ensurePriced).
 */
export async function syncServiceTotals(exec: Exec, orderId: number): Promise<void> {
  const r = await exec.execute(sql`SELECT subtotal_cents, delivery_fee_cents, tax_percent, tax_cents, total_cents, services_cents, services_tax_cents FROM orders WHERE id = ${orderId} FOR UPDATE`);
  const o = r.rows[0] as { subtotal_cents: number; delivery_fee_cents: number; tax_percent: string | null; tax_cents: number; total_cents: number | null; services_cents: number; services_tax_cents: number } | undefined;
  if (!o) return;
  const sums = sumServices(await listServices(orderId, exec));
  if (o.total_cents === null) {
    await exec.execute(sql`UPDATE orders SET services_cents = ${sums.cents}, services_tax_cents = 0, updated_at = now() WHERE id = ${orderId}`);
    return;
  }
  const sub = Number(o.subtotal_cents);
  const fee = Number(o.delivery_fee_cents);
  const baseTax = Number(o.tax_cents) - Number(o.services_tax_cents);
  const baseTotal = Number(o.total_cents) - Number(o.services_cents) - Number(o.services_tax_cents);
  let servicesTax = 0;
  if (sums.taxableCents) {
    if (o.tax_percent !== null) servicesTax = taxOn(sub + fee + sums.taxableCents, String(o.tax_percent)) - taxOn(sub + fee, String(o.tax_percent));
    else {
      // An amount set by hand (no rentals priced): the services are taxed at today's sales tax rate
      const { getSettings } = await import("@/lib/settings");
      servicesTax = taxOn(sums.taxableCents, (await getSettings()).salesTaxPercent);
    }
  }
  await exec.execute(sql`UPDATE orders SET services_cents = ${sums.cents}, services_tax_cents = ${servicesTax}, tax_cents = ${baseTax + servicesTax}, total_cents = ${baseTotal + sums.cents + servicesTax}, updated_at = now() WHERE id = ${orderId}`);
}

/** A payment was taken: every service on the order now is part of what was paid for (it cannot change any more). */
export async function lockServices(orderId: number, exec: Pick<typeof db, "execute"> = db): Promise<void> {
  await exec.execute(sql`UPDATE order_services SET locked_at = now() WHERE order_id = ${orderId} AND locked_at IS NULL`);
}

const FINISHED = ["CANCELLED"];

async function orderFor(tx: Exec, orderId: number) {
  const [o] = await tx.select({ id: schema.orders.id, status: schema.orders.status }).from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
  if (!o) throw new ServiceError("Order not found.");
  if (FINISHED.includes(o.status)) throw new ServiceError("This order is cancelled. Services cannot be added or changed on a cancelled order.");
  return o;
}

async function audit(tx: Exec, userId: number | null, action: string, orderId: number, before: unknown, after: unknown) {
  await (tx as typeof db).insert(schema.auditLog).values({ userId, action, entityType: "order", entityId: String(orderId), before: before as never, after: after as never });
}

export async function addService(orderId: number, input: ServiceInput, userId: number | null): Promise<OrderService> {
  const p = parseService(input);
  if (!p.ok) throw new ServiceError(p.message);
  return db.transaction(async (tx) => {
    await orderFor(tx, orderId);
    const [row] = await tx.insert(schema.orderServices).values({ orderId, ...p.value, createdBy: userId }).returning();
    await syncServiceTotals(tx, orderId);
    await audit(tx, userId, "order.service_added", orderId, null, { id: row.id, name: row.name, amountCents: row.amountCents, taxable: row.taxable, note: row.note });
    return row;
  });
}

async function editable(tx: Exec, orderId: number, serviceId: number) {
  const [s] = await tx.select().from(schema.orderServices).where(eq(schema.orderServices.id, serviceId)).limit(1);
  if (!s || s.orderId !== orderId) throw new ServiceError("Service not found on this order.");
  if (s.lockedAt) throw new ServiceError("This service was already paid for, so it cannot be changed or removed. To give money back, use Refund.");
  return s;
}

export async function updateService(orderId: number, serviceId: number, input: ServiceInput, userId: number | null): Promise<OrderService> {
  const p = parseService(input);
  if (!p.ok) throw new ServiceError(p.message);
  return db.transaction(async (tx) => {
    await orderFor(tx, orderId);
    const before = await editable(tx, orderId, serviceId);
    const [row] = await tx.update(schema.orderServices).set({ ...p.value, updatedAt: new Date() }).where(eq(schema.orderServices.id, serviceId)).returning();
    await syncServiceTotals(tx, orderId);
    const pick = (s: OrderService) => ({ name: s.name, amountCents: s.amountCents, taxable: s.taxable, note: s.note, showNoteOnReceipt: s.showNoteOnReceipt });
    await audit(tx, userId, "order.service_changed", orderId, { id: serviceId, ...pick(before) }, { id: serviceId, ...pick(row) });
    return row;
  });
}

export async function removeService(orderId: number, serviceId: number, userId: number | null): Promise<void> {
  await db.transaction(async (tx) => {
    await orderFor(tx, orderId);
    const before = await editable(tx, orderId, serviceId);
    await tx.delete(schema.orderServices).where(eq(schema.orderServices.id, serviceId));
    await syncServiceTotals(tx, orderId);
    await audit(tx, userId, "order.service_removed", orderId, { id: serviceId, name: before.name, amountCents: before.amountCents }, null);
  });
}

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

/**
 * How a service reads to the customer: its name and amount only (no new words), with the note in brackets only when
 * staff ticked "show note on receipt". Used on the pay page, card page, texts, emails and invoices.
 */
export function customerServiceText(s: Pick<OrderService, "name" | "amountCents" | "note" | "showNoteOnReceipt">): string {
  return `${s.name} ${money(s.amountCents)}${s.showNoteOnReceipt && s.note ? ` (${s.note})` : ""}`;
}

/**
 * Plain-English help for every field in the Services box on the order page (handoff rule: every Admin item is
 * explained: what it does, where it is used, and what happens if it changes). Tax questions go to the accountant.
 */
export const SERVICE_FIELD_EXPLANATIONS: Record<"name" | "amount" | "note" | "showNoteOnReceipt" | "taxable" | "box", { what: string; where: string; ifChanged: string; askAccountant?: boolean }> = {
  box: {
    what: "Adds a charge that is not a rental item, with an amount you type, for example extra setup or a late pickup fee. Each one is its own line, numbered in the order you add them.",
    where: "The line shows by its name and amount on this order, the review and pay page, the secure card page, the payment link, the invoice and receipt, and in Bookkeeping as services income.",
    ifChanged: "The order total and the sales tax change right away. It never touches the calendar, the stock or the equipment units. Once a payment is taken, the services on the order then are locked; a service added after that makes a balance due.",
  },
  name: {
    what: "What the charge is for, as the customer will read it, for example Extra setup or Late pickup fee. Required.",
    where: "Shown word for word on this order, on everything the customer sees (pay page, card page, payment link, receipt) and in Bookkeeping.",
    ifChanged: "The new name shows everywhere from now on. Texts and emails already sent keep the old name.",
  },
  amount: {
    what: "The price of this service in dollars and cents, for example 25.00. Required and more than zero. To give money back, use Refund instead.",
    where: "Added to the order total. If the service is taxable, sales tax is added on it too.",
    ifChanged: "The total and the sales tax change at once. If the payment link was already sent, send it again so the customer pays the new amount.",
  },
  note: {
    what: "Optional. A few words for staff about what the charge is, for example Setup on the lawn behind the house.",
    where: "Always shown on this order and in Admin. The customer sees it only if you tick Show the note on the receipt.",
    ifChanged: "Only the note text changes. The amount stays the same.",
  },
  showNoteOnReceipt: {
    what: "Tick it to also show the note to the customer, next to the service name.",
    where: "The receipt and invoice, the review and pay page, the secure card page and the payment link text.",
    ifChanged: "Unticked, the customer sees only the name and the amount; the note stays inside Admin.",
  },
  taxable: {
    what: "Ticked (the usual choice) means sales tax is charged on this service, like on the rentals and delivery. Untick it only for a charge that is not taxed. Ask your accountant if you are not sure.",
    where: "Sales tax line of this order, the payment amount, and the sales tax collected in Bookkeeping.",
    ifChanged: "The sales tax and the total change at once. Ask your accountant before marking a charge as not taxed.",
    askAccountant: true,
  },
};
