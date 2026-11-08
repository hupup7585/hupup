import { formatMoney } from "@/lib/money";
import { METHODS } from "@/lib/books";

/** Small shared pieces for the Bookkeeping screens (server components, plain forms). */

export const money = (c: number) => (c < 0 ? `-${formatMoney(-c)}` : formatMoney(c));

export function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`block min-w-0 text-sm ${wide ? "sm:col-span-2" : ""}`}>
      <span className="mb-1 block font-semibold text-muted">{label}</span>
      {children}
    </label>
  );
}

export function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>;
}

export function Card({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <section className="card mb-5 min-w-0 p-5">
      <h2 className="mb-1 text-lg font-bold">{title}</h2>
      {note && <p className="mb-3 text-sm text-muted">{note}</p>}
      {!note && <div className="mb-2" />}
      {children}
    </section>
  );
}

export function MethodSelect({ defaultValue }: { defaultValue?: string }) {
  return (
    <select name="method" defaultValue={defaultValue ?? ""} className="input">
      <option value="">—</option>
      {METHODS.map((m) => (
        <option key={m} value={m}>
          {m === "zelle" ? "Zelle" : m[0].toUpperCase() + m.slice(1)}
        </option>
      ))}
    </select>
  );
}

export function CategorySelect({ categories, name = "category", defaultValue }: { categories: string[]; name?: string; defaultValue?: string }) {
  return (
    <select name={name} defaultValue={defaultValue ?? ""} className="input">
      <option value="">—</option>
      {categories.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  );
}

export function FileInput() {
  return <input type="file" name="file" accept="application/pdf,image/*" className="input py-2 text-sm" />;
}

export function Table({ head, rows, empty, minWidth = 640 }: { head: string[]; rows: React.ReactNode[][]; empty: string; minWidth?: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" style={{ minWidth }}>
        <thead>
          <tr>{head.map((h) => <th key={h} className="th">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-bg">
              {r.map((c, j) => (
                <td key={j} className="td">{c}</td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={head.length} className="py-6 text-center text-muted">{empty}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Save({ label = "Save" }: { label?: string }) {
  return <button className="btn-dark">{label}</button>;
}

export function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-sm font-semibold text-muted">{label}</div>
      <div className="text-2xl font-black">{value}</div>
      {note && <div className="text-xs text-muted">{note}</div>}
    </div>
  );
}
