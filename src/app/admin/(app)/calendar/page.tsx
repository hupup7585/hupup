import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import StaffGreeting from "@/components/StaffGreeting";
import DateRangeHeading from "@/components/DateRangeHeading";
import MyTasksCard from "@/components/MyTasksCard";
import { asc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getUsage, freeOnDay, bookableQty } from "@/lib/availability";
import { runsForDay } from "@/lib/admin-queries";
import { addDays, dayOfMonth, daysBetween, isValidISO, todayISO, weekdayShort } from "@/lib/dates";

/** The Sunday that starts this date's week (weeks run Sunday to Shabbos). */
const sundayOf = (iso: string) => addDays(iso, -new Date(`${iso}T12:00:00Z`).getUTCDay());
import { formatPhone } from "@/lib/phone";
import { orderNumber } from "@/lib/orders";
import { StatusBadge } from "@/components/StatusBadge";
import DualDate, { HebrewDay } from "@/components/DualDate";
import { dualDate } from "@/lib/dual-date";
import { DELIVERY_WINDOW, PICKUP_BY } from "@/lib/rental-days";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string; day?: string; span?: string }>;
}) {
  const staff = await requireAdmin();
  const sp = await searchParams;
  const today = todayISO();
  const span = sp.span === "14" ? 14 : sp.span === "28" ? 28 : 7;
  const dayParam = sp.day && isValidISO(sp.day) ? sp.day : null;
  const start = sp.start && isValidISO(sp.start) ? sp.start : sundayOf(dayParam ?? today); // Sunday-Shabbos weeks (Abraham)
  const end = addDays(start, span - 1);
  const days = daysBetween(start, end);
  const selected = dayParam ?? (days.includes(today) ? today : start);

  const [cats, prods, usage, runs] = await Promise.all([
    db.select().from(schema.categories).orderBy(asc(schema.categories.sortOrder), asc(schema.categories.id)),
    db.select().from(schema.products).orderBy(asc(schema.products.sortOrder), asc(schema.products.id)),
    getUsage(start, addDays(end, 1)),
    runsForDay(selected),
  ]);

  const q = (o: Record<string, string | number>) =>
    "/admin/calendar?" + new URLSearchParams({ start, span: String(span), day: selected, ...Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)])) }).toString();

  return (
    <div className="mx-auto max-w-7xl">
      {staff.role !== "owner" && <StaffGreeting staff={staff} as="p" className="mb-3 text-xl font-black sm:text-2xl" />}
      {staff.role === "secretary" && <MyTasksCard staff={staff} />}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <DateRangeHeading title="Availability" from={start} to={end} />
        <div className="flex flex-wrap items-center gap-2">
          <Link className="btn-ghost" href={q({ start: addDays(start, -span) })}>◀</Link>
          <Link className="btn-ghost" href={q({ start: sundayOf(today), day: today })}>Today</Link>
          <Link className="btn-ghost" href={q({ start: addDays(start, span) })}>▶</Link>
          {[7, 14, 28].map((s) => (
            <Link key={s} className={`btn-ghost ${s === span ? "!border-navy" : ""}`} href={q({ span: s })}>
              {s === 7 ? "Week" : s === 14 ? "2 weeks" : "4 weeks"}
            </Link>
          ))}
          <Link className="btn" href={`/admin/pos?date=${selected}`}>+ New booking</Link>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full border-collapse text-sm" style={{ minWidth: 260 + days.length * (span > 7 ? 64 : 110) }}>
          <thead>
            <tr>
              <th className="sticky left-0 z-10 w-56 border-b border-line bg-white px-4 py-3 text-left text-xs font-semibold text-muted">
                Item (units owned)
              </th>
              {days.map((d) => (
                <th key={d} className={`border-b border-l border-line px-1 py-2 text-center text-xs font-semibold ${d === today ? "text-coral" : "text-muted"}`}>
                  <Link href={q({ day: d })} className={`block rounded-lg py-1 ${d === selected ? "bg-navy text-white" : ""}`}>
                    {weekdayShort(d)} {dayOfMonth(d)}
                    <HebrewDay yi dayOnly iso={d} className="block text-[10px] font-normal" />
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cats.map((c) => {
              const items = prods.filter((p) => p.categoryId === c.id && p.active);
              if (!items.length) return null;
              return [
                <tr key={`c${c.id}`}>
                  <td colSpan={days.length + 1} className="bg-bg px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
                    {c.ivrDigit ? `${c.ivrDigit} · ` : ""}{c.name}
                  </td>
                </tr>,
                ...items.map((p) => (
                  <tr key={p.id}>
                    <td className="sticky left-0 z-10 border-b border-line bg-white px-4 py-2 font-bold">
                      {p.name} <span className="font-normal text-muted">({p.quantity})</span>
                    </td>
                    {days.map((d) => {
                      const u = usage.get(p.id)?.get(d) ?? { event: 0, pickup: 0, held: 0 };
                      const free = freeOnDay(p.quantity, usage, p.id, d);
                      const canBook = bookableQty(p.quantity, usage, p.id, d);
                      let cls = "bg-[#E3F8EF] text-[#13895C]";
                      let label = `${free} free`;
                      if (u.held > 0) {
                        cls = "border border-dashed border-sky bg-[repeating-linear-gradient(45deg,#E5F3FF,#E5F3FF_6px,#fff_6px,#fff_12px)] text-[#1170C0]";
                        label = `${free} · ${u.held} held`;
                      } else if (free === 0 && u.event > 0) {
                        cls = "bg-[#FFE6E4] text-[#C83A2F]";
                        label = "Booked";
                      } else if (free === 0) {
                        cls = "bg-[#FFF4D6] text-[#A87800]";
                        label = "Pickup";
                      } else if (u.pickup > 0 && u.event === 0) {
                        cls = "bg-[#FFF4D6] text-[#A87800]";
                        label = `${free} · pickup`;
                      } else if (u.event > 0) {
                        cls = "bg-[#FFE6E4] text-[#C83A2F]";
                        label = `${free} free`;
                      }
                      const title = `${p.name} on ${dualDate(d)}: ${u.event} delivering, ${u.pickup} being picked up, ${free} free that day; ${canBook} bookable for an event this day (needs next day free for pickup).`;
                      return (
                        <td key={d} className="border-b border-l border-line p-1">
                          <Link
                            href={canBook > 0 ? `/admin/pos?date=${d}&product=${p.id}` : q({ day: d })}
                            title={title}
                            className={`grid h-11 place-items-center rounded-lg text-xs font-extrabold ${cls}`}
                          >
                            {span > 7 ? (label === "Booked" || label === "Pickup" ? label : free) : label}
                          </Link>
                        </td>
                      );
                    })}
                  </tr>
                )),
              ];
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-sm text-muted">
        <span><i className="mr-1.5 inline-block h-3.5 w-3.5 rounded bg-[#E3F8EF] align-[-2px]" />Available</span>
        <span><i className="mr-1.5 inline-block h-3.5 w-3.5 rounded bg-[#FFE6E4] align-[-2px]" />Booked (event day)</span>
        <span><i className="mr-1.5 inline-block h-3.5 w-3.5 rounded bg-[#FFF4D6] align-[-2px]" />Pickup day (still out)</span>
        <span><i className="mr-1.5 inline-block h-3.5 w-3.5 rounded border border-dashed border-sky bg-[#E5F3FF] align-[-2px]" />Held in a live phone cart</span>
        <span>Click a green cell to book that item for that day.</span>
      </div>

      <div className="card mt-5 grid gap-6 p-5 md:grid-cols-2">
        {(["delivery", "pickup"] as const).map((kind) => {
          const list = runs.filter((r) => r.kind === kind);
          return (
            <div key={kind}>
              <h2 className="mb-3 font-bold">
                {kind === "delivery" ? "Deliveries" : "Pickups"} · <DualDate yi iso={selected} />
              </h2>
              {list.length === 0 && <p className="text-sm text-muted">None.</p>}
              {list.map((r) => (
                <Link key={r.id} href={`/admin/orders/${r.id}`} className="mb-2 flex items-start gap-3 rounded-xl bg-bg p-3 hover:bg-[#ECF1F9]">
                  <b className="min-w-14 whitespace-nowrap">{kind === "delivery" ? "9–12" : `By ${PICKUP_BY}`}</b>
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold">{r.items}</span>
                    <span className="block text-sm text-muted">
                      Order number {orderNumber(r.id)} · {r.customer_name} · {formatPhone(r.customer_phone)} · {r.delivery_address}
                    </span>
                  </span>
                  <StatusBadge status={r.status} />
                </Link>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
