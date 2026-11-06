import Link from "next/link";
import { and, eq, inArray, or } from "drizzle-orm";
import { Clock, MapPin } from "lucide-react";
import { requireStaff } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { addDays, longDate, todayISO } from "@/lib/dates";
import { orderNumber } from "@/lib/orders";
import { Badge, PageHeader } from "@/components/staff/ui";
import PrintButton from "@/components/staff/PrintButton";
import { logoutAction } from "../login/actions";
import ExportButtons from "@/components/ExportButtons";
import StopActions from "./StopActions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Deliveries · Hup Up Attractions", robots: { index: false } };

/**
 * Delivery day timeline. Delivery staff see stops (customer, phone, address, items, notes) but no prices.
 * Delivery stops are paid orders out that day; pickup stops are orders coming back that day.
 */
export default async function DeliveriesPage({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const staff = await requireStaff(["owner", "secretary", "delivery"]);
  const sp = await searchParams;
  const day = sp.d && /^\d{4}-\d{2}-\d{2}$/.test(sp.d) ? sp.d : todayISO();
  const rows = await db
    .select()
    .from(schema.orders)
    .where(and(inArray(schema.orders.status, ["CONFIRMED", "DELIVERED", "PICKED_UP"]), or(eq(schema.orders.eventDate, day), eq(schema.orders.pickupDate, day))));
  const ids = rows.map((r) => r.id);
  const items = ids.length
    ? await db
        .select({ orderId: schema.orderItems.orderId, qty: schema.orderItems.qty, name: schema.products.name })
        .from(schema.orderItems)
        .innerJoin(schema.products, eq(schema.products.id, schema.orderItems.productId))
        .where(inArray(schema.orderItems.orderId, ids))
    : [];
  const custIds = rows.map((r) => r.customerId).filter((x): x is number => Boolean(x));
  const customers = custIds.length ? await db.select().from(schema.customers).where(inArray(schema.customers.id, custIds)) : [];
  const stops = rows
    .flatMap((o) => {
      const out = [];
      if (o.eventDate === day) out.push({ o, stop: "delivery" as const, done: o.status !== "CONFIRMED" });
      if (o.pickupDate === day) out.push({ o, stop: "pickup" as const, done: o.status === "PICKED_UP" });
      return out;
    })
    .sort((a, b) => (a.o.deliveryTime || "99").localeCompare(b.o.deliveryTime || "99"));

  return (
    <div className="min-h-screen bg-bg">
      <header className="no-print flex items-center justify-between gap-3 bg-navy px-4 py-3 text-white">
        <div className="font-display text-lg font-extrabold tracking-tight">
          Hup Up <span className="text-sun">Attractions</span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="hidden text-white/80 sm:inline">
            {staff.name} · <span className="capitalize">{staff.role}</span>
          </span>
          {staff.role !== "delivery" && (
            <Link href="/admin/orders" className="font-semibold text-sky hover:underline">
              Back to admin
            </Link>
          )}
          <form action={logoutAction}>
            <button className="font-semibold text-white/80 hover:text-white">Sign out</button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">
        <PageHeader
          title="Deliveries"
          subtitle={longDate(day)}
          actions={
            <>
              <Link className="btn-ghost" href={`/admin/deliveries?d=${addDays(day, -1)}`}>← Previous day</Link>
              <Link className="btn-ghost" href={`/admin/deliveries?d=${addDays(day, 1)}`}>Next day →</Link>
              <PrintButton label="Print schedule" />
              {staff.role !== "delivery" && <ExportButtons report="deliveries" params={{ from: day, to: addDays(day, 6) }} />}
            </>
          }
        />
        {!stops.length && <p className="card p-6 text-muted">No deliveries or pickups on this day.</p>}
        <ol className="relative space-y-4 border-l-2 border-sky/60 pl-5">
          {stops.map(({ o, stop, done }) => {
            const c = customers.find((x) => x.id === o.customerId);
            const its = items.filter((i) => i.orderId === o.id);
            const tone = done ? "done" : o.status === "CONFIRMED" && stop === "delivery" ? "scheduled" : "pending";
            return (
              <li key={`${o.id}-${stop}`} className="relative" data-stop={stop}>
                <span className="absolute -left-[29px] top-3 h-4 w-4 rounded-full border-2 border-white bg-navy ring-2 ring-sky" aria-hidden />
                <article className="card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-bold">
                      <Clock className="h-4 w-4" aria-hidden />
                      <span>{o.deliveryTime || "Time not set"}</span>
                      <span className="text-muted">· {stop === "delivery" ? "Delivery" : "Pickup"} · #{orderNumber(o.id)}</span>
                    </div>
                    <Badge tone={tone}>{done ? (stop === "delivery" ? "Delivered" : "Picked up") : stop === "delivery" ? "Scheduled" : "To pick up"}</Badge>
                  </div>
                  <div className="mt-2 text-lg font-bold">{c?.name || "Customer"}</div>
                  <div className="mt-0.5 flex items-start gap-1.5 text-sm">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    {o.deliveryAddress ? (
                      <a className="underline-offset-2 hover:underline" href={`https://maps.google.com/?q=${encodeURIComponent(o.deliveryAddress)}`}>
                        {o.deliveryAddress}
                      </a>
                    ) : (
                      "No address"
                    )}
                  </div>
                  <div className="mt-0.5 text-sm text-muted">{its.map((i) => `${i.qty} × ${i.name}`).join(", ")}</div>
                  {o.notes && <div className="mt-1 text-sm">Note: {o.notes}</div>}
                  <StopActions orderId={o.id} phone={c?.phone ?? null} stop={stop} done={done} />
                </article>
              </li>
            );
          })}
        </ol>
      </main>
    </div>
  );
}
