import { asc } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { UNIT_STATUSES } from "@/lib/db/schema";
import { UNIT_STATUS_LABEL, listUnits, unitHistory } from "@/lib/units";
import { dualDateTime } from "@/lib/dual-date";
import { addUnitAction, unitStatusAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Equipment units · Hup Up Attractions", robots: { index: false } };

const money = (c: number | null) => (c == null ? "" : `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`);

/** Equipment units (Abraham, Nov 15, 2026). One row per physical unit; only Available units can be booked. */
export default async function UnitsPage({ searchParams }: { searchParams: Promise<{ m?: string; unit?: string }> }) {
  const staff = await requireAdmin();
  const owner = staff.role === "owner";
  const { m, unit } = await searchParams;
  const [rows, products] = await Promise.all([
    listUnits(),
    db.select({ id: schema.products.id, name: schema.products.name }).from(schema.products).orderBy(asc(schema.products.name)),
  ]);
  const open = unit ? rows.find((r) => r.unit.id === Number(unit)) : undefined;
  const hist = open ? await unitHistory(open.unit.id) : null;

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-2xl font-black sm:text-3xl">Equipment units</h1>
      <p className="mb-4 mt-1 text-muted">
        Each physical unit has its own ID. An item&rsquo;s stock is the number of its Available units. A unit that is damaged, missing, under maintenance or unavailable can&rsquo;t be booked. Items with no units here keep the quantity typed in Catalog.
      </p>
      {m && <p className="card mb-4 p-3 text-sm font-semibold" data-units-message>{m}</p>}

      <div className="card overflow-x-auto" data-units-list>
        <table className="w-full text-sm">
          <thead>
            <tr><th className="th">Unit ID</th><th className="th">Item</th><th className="th">Status</th><th className="th">Condition</th><th className="th">Location</th><th className="th">Serial / model</th><th className="th">Value</th><th className="th"></th></tr>
          </thead>
          <tbody>
            {rows.map(({ unit: u, product }) => (
              <tr key={u.id} data-unit-row={u.code}>
                <td className="td font-mono font-semibold"><a className="underline" href={`/admin/units?unit=${u.id}`}>{u.code}</a></td>
                <td className="td">{product}</td>
                <td className={`td font-semibold ${u.status === "available" ? "text-navy" : "text-[#C83A2F]"}`}>{UNIT_STATUS_LABEL[u.status as keyof typeof UNIT_STATUS_LABEL] ?? u.status}</td>
                <td className="td capitalize">{u.condition}</td>
                <td className="td">{u.location ?? ""}</td>
                <td className="td text-xs">{[u.serial, u.model].filter(Boolean).join(" · ")}</td>
                <td className="td">{money(u.replacementValueCents)}</td>
                <td className="td">
                  <details>
                    <summary className="cursor-pointer">Change status</summary>
                    <form action={unitStatusAction} className="mt-2 grid gap-2">
                      <input type="hidden" name="unitId" value={u.id} />
                      <select name="status" className="input" defaultValue={u.status}>
                        {UNIT_STATUSES.filter((s) => owner || s === "available").map((s) => <option key={s} value={s}>{UNIT_STATUS_LABEL[s]}</option>)}
                      </select>
                      <input name="reason" className="input" placeholder="Reason (needed to take it out of service)" />
                      <button className="btn-ghost">Save</button>
                    </form>
                  </details>
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td className="td text-muted" colSpan={8}>No units yet. Items keep the quantity typed in Catalog until units are added.</td></tr>}
          </tbody>
        </table>
      </div>

      {open && hist && (
        <section className="card mt-5 p-5" data-unit-history>
          <h2 className="text-lg font-black">History of {open.unit.code}</h2>
          <p className="mt-1 text-sm">Rented {hist.rentals} times, {hist.daysOut} days out, {money(hist.revenueCents)} in rentals.</p>
          <ul className="mt-3 space-y-1 text-sm">
            {hist.status.map((h) => (
              <li key={h.id}>{dualDateTime(h.at)}: {h.fromStatus ? `${UNIT_STATUS_LABEL[h.fromStatus as keyof typeof UNIT_STATUS_LABEL]} to ` : ""}{UNIT_STATUS_LABEL[h.toStatus as keyof typeof UNIT_STATUS_LABEL]}{h.reason ? `, ${h.reason}` : ""}</li>
            ))}
          </ul>
          {hist.orderIds.length > 0 && <p className="mt-3 text-sm">Orders: {hist.orderIds.map((id) => <a key={id} className="mr-2 underline" href={`/admin/orders/${id}`}>Order number {1000 + id}</a>)}</p>}
        </section>
      )}

      {owner && (
        <form action={addUnitAction} className="card mt-5 grid gap-3 p-5 sm:grid-cols-3" data-unit-form>
          <h2 className="text-lg font-black sm:col-span-3">Add a unit</h2>
          <label className="block"><span className="label">Item</span><select name="productId" required className="input">{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label className="block"><span className="label">Unit ID</span><input name="code" required className="input font-mono" placeholder="CASTLE-01" /></label>
          <label className="block"><span className="label">Condition</span><select name="condition" className="input" defaultValue="good"><option value="good">Good</option><option value="fair">Fair</option><option value="poor">Poor</option></select></label>
          <label className="block"><span className="label">Serial number</span><input name="serial" className="input" /></label>
          <label className="block"><span className="label">Model</span><input name="model" className="input" /></label>
          <label className="block"><span className="label">Storage location</span><input name="location" className="input" placeholder="Warehouse, shelf 2" /></label>
          <label className="block"><span className="label">Purchase date</span><input name="purchaseDate" type="date" className="input" /></label>
          <label className="block"><span className="label">Purchase price</span><input name="purchasePrice" inputMode="decimal" className="input" placeholder="1200.00" /></label>
          <label className="block"><span className="label">Replacement value</span><input name="replacementValue" inputMode="decimal" className="input" placeholder="1500.00" /></label>
          <label className="block sm:col-span-3"><span className="label">Notes</span><input name="notes" className="input" /></label>
          <button className="btn-dark sm:col-span-3 sm:w-fit">Add unit</button>
        </form>
      )}
    </div>
  );
}
