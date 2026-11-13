import Link from "next/link";
import { and, eq, inArray, or } from "drizzle-orm";
import { Clock, MapPin, Navigation, Route, Warehouse } from "lucide-react";
import { requireStaff } from "@/lib/auth";
import StaffGreeting from "@/components/StaffGreeting";
import MyTasksCard from "@/components/MyTasksCard";
import { db, schema } from "@/lib/db";
import { addDays, todayISO } from "@/lib/dates";
import { orderNumber } from "@/lib/orders";
import { getSettings } from "@/lib/settings";
import { dayRunLinks, firstLeg, nextLeg, type NextLeg, type RouteStop } from "@/lib/delivery-route";
import { Badge, PageHeader } from "@/components/staff/ui";
import PrintButton from "@/components/staff/PrintButton";
import { logoutAction } from "../login/actions";
import StopActions from "./StopActions";
import DualDate from "@/components/DualDate";
import { DELIVERY_WINDOW, PICKUP_BY } from "@/lib/rental-days";
import { driverOf, isMyStop } from "@/lib/drivers";

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
  const driverNames = new Map((await db.select({ id: schema.adminUsers.id, name: schema.adminUsers.name }).from(schema.adminUsers).where(eq(schema.adminUsers.role, "delivery"))).map((d) => [d.id, d.name]));
  const custIds = rows.map((r) => r.customerId).filter((x): x is number => Boolean(x));
  const customers = custIds.length ? await db.select().from(schema.customers).where(inArray(schema.customers.id, custIds)) : [];
  const stops = rows
    .flatMap((o) => {
      const out = [];
      if (o.eventDate === day) out.push({ o, stop: "delivery" as const, done: o.status !== "CONFIRMED" });
      if (o.pickupDate === day) out.push({ o, stop: "pickup" as const, done: o.status === "PICKED_UP" });
      return out;
    })
    // A Delivery login sees only the stops assigned to it (checked here on the server, not in the browser)
    .filter(({ o, stop }) => staff.role !== "delivery" || isMyStop(o, stop, staff.userId))
    .sort((a, b) => (a.o.deliveryTime || "99").localeCompare(b.o.deliveryTime || "99"));

  // Navigation (free Google Maps / Waze links): stops in the order shown, then back to stock
  const stockAddress = (await getSettings()).stockAddress.trim() || null;
  const route: RouteStop[] = stops.map(({ o, stop, done }) => ({
    key: `${o.id}-${stop}`,
    address: o.deliveryAddress,
    label: `${stop === "delivery" ? "Drop off" : "Pick up"} · ${customers.find((x) => x.id === o.customerId)?.name || "Customer"}`,
    done,
  }));
  const run = dayRunLinks(route, stockAddress);
  const first = firstLeg(route);
  const noAddress = route.filter((r) => !r.address?.trim()).length;

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
          <Link href="/admin/tasks" className="font-semibold text-sky hover:underline">
            Tasks
          </Link>
          <form action={logoutAction}>
            <button className="font-semibold text-white/80 hover:text-white">Sign out</button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">
        {staff.role === "delivery" && <StaffGreeting staff={staff} as="p" className="mb-3 text-xl font-black sm:text-2xl" />}
        <PageHeader
          title="Deliveries"
          subtitle={<DualDate yi iso={day} className="text-lg font-extrabold text-navy" />}
          actions={
            <>
              <Link className="btn-ghost" href={`/admin/deliveries?d=${addDays(day, -1)}`}>← Previous day</Link>
              <Link className="btn-ghost" href={`/admin/deliveries?d=${addDays(day, 1)}`}>Next day →</Link>
              <PrintButton label="Print schedule" />
            </>
          }
        />
        <MyTasksCard staff={staff} />
        {!stops.length && <p className="card p-6 text-muted">{staff.role === "delivery" ? "No deliveries or pickups assigned to you on this day." : "No deliveries or pickups on this day."}</p>}
        {stops.length > 0 && (
          <section data-route-card className="no-print card mb-5 p-4" aria-label="Today's route">
            <h2 className="flex items-center gap-2 text-lg font-extrabold">
              <Route className="h-5 w-5" aria-hidden /> Route
            </h2>
            <p className="mt-1 flex items-start gap-1.5 text-sm text-muted">
              <Warehouse className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {stockAddress ? (
                <span>
                  Starts and ends at stock: <span className="font-semibold text-navy">{stockAddress}</span>
                </span>
              ) : (
                <span>No stock address yet, so routes start from your location{staff.role === "owner" ? " (set it in Admin, Settings)" : ""}.</span>
              )}
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {run.whole.map((l) => (
                <a key={l.url} data-route-whole href={l.url} target="_blank" rel="noopener noreferrer" className="btn-dark">
                  <Route className="h-4 w-4" aria-hidden /> {l.label}
                </a>
              ))}
              {run.remaining.map((l) => (
                <a key={l.url} data-route-remaining href={l.url} target="_blank" rel="noopener noreferrer" className="btn-ghost">
                  <Route className="h-4 w-4" aria-hidden /> {l.label}
                </a>
              ))}
            </div>
            {first && <LegLinks leg={first} prefix="First stop" />}
            {noAddress > 0 && <p className="mt-2 text-sm font-semibold text-[#b3261e]">{noAddress === 1 ? "1 stop has" : `${noAddress} stops have`} no address and {noAddress === 1 ? "is" : "are"} left out of the route.</p>}
          </section>
        )}
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
                      <span>{stop === "delivery" ? DELIVERY_WINDOW : `By ${PICKUP_BY}`}</span>
                      <span className="text-muted">· {stop === "delivery" ? "Delivery" : "Pickup"} · Order number {orderNumber(o.id)}</span>
                    </div>
                    <Badge tone={tone}>{done ? (stop === "delivery" ? "Delivered" : "Picked up") : stop === "delivery" ? "Scheduled" : "To pick up"}</Badge>
                  </div>
                  {staff.role !== "delivery" && (
                    <div className="mt-1 text-sm" data-stop-driver>
                      Driver: {driverOf(o, stop) ? <b>{driverNames.get(driverOf(o, stop)!) ?? "Unknown"}</b> : <b className="text-[#b3261e]">Not assigned</b>}
                    </div>
                  )}
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
                  {(() => {
                    const leg = nextLeg(route, route.findIndex((r) => r.key === `${o.id}-${stop}`), stockAddress);
                    return leg ? <LegLinks leg={leg} prefix={leg.toStock ? "Then" : "Next"} /> : null;
                  })()}
                </article>
              </li>
            );
          })}
        </ol>
      </main>
    </div>
  );
}

/** "Next: Pick up · Name" with Google Maps and Waze buttons (large, thumb-friendly). */
function LegLinks({ leg, prefix }: { leg: NextLeg; prefix: string }) {
  return (
    <div data-next-leg className="no-print mt-3 rounded-xl border border-line bg-bg p-3">
      <div className="text-sm">
        <span className="font-bold">
          {prefix}: {leg.label}
        </span>
        <span className="block text-muted">{leg.address}</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <a data-nav="google" href={leg.google} target="_blank" rel="noopener noreferrer" className="btn-ghost whitespace-nowrap px-3">
          <Navigation className="h-4 w-4 shrink-0" aria-hidden /> Google Maps
        </a>
        <a data-nav="waze" href={leg.waze} target="_blank" rel="noopener noreferrer" className="btn-ghost whitespace-nowrap px-3">
          <Navigation className="h-4 w-4 shrink-0" aria-hidden /> Waze
        </a>
      </div>
    </div>
  );
}
