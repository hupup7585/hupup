import { Camera, CheckCircle2, Clock, MapPin, MessageSquareText, Phone, Plus } from "lucide-react";
import { Badge, Field, PageHeader, Section, type Tone } from "@/components/staff/ui";
import PrintButton from "@/components/staff/PrintButton";

export const metadata = { title: "Staff screens (preview) · Hup Up Attractions" };

/**
 * DESIGN PREVIEW ONLY. Shows the shared staff theme on the three screen types (entry form, secretary worksheet
 * with entry log, delivery day timeline) using clearly labeled SAMPLE data. Nothing here reads or writes data;
 * buttons are disabled. The real screens will use these same pieces when their features are built.
 */

const SAMPLE_WORKSHEET: { time: string; customer: string; item: string; town: string; status: [Tone, string] }[] = [
  { time: "9:00 AM", customer: "Sample Customer A", item: "Castle Jumping Balloon", town: "Kiryas Joel", status: ["scheduled", "Scheduled"] },
  { time: "10:30 AM", customer: "Sample Customer B", item: "Laser Tag Set (10)", town: "Monroe", status: ["pending", "Pending"] },
  { time: "12:00 PM", customer: "Sample Customer C", item: "Paddle Boat", town: "Harriman", status: ["done", "Done"] },
];

const SAMPLE_LOG = [
  { at: "8:42 AM", who: "Secretary", note: "Called Sample Customer B to confirm the gate code." },
  { at: "8:15 AM", who: "Owner", note: "Moved Sample Customer A to the 9:00 AM slot." },
];

const SAMPLE_STOPS: { time: string; kind: string; customer: string; address: string; items: string; status: [Tone, string] }[] = [
  { time: "8:30 AM", kind: "Delivery", customer: "Sample Customer A", address: "12 Sample Rd, Kiryas Joel", items: "1 × Castle Jumping Balloon", status: ["done", "Delivered"] },
  { time: "10:00 AM", kind: "Delivery", customer: "Sample Customer B", address: "4 Example Ln, Monroe", items: "1 × Laser Tag Set (10)", status: ["pending", "Out for delivery"] },
  { time: "1:00 PM", kind: "Pickup", customer: "Sample Customer D", address: "88 Demo Ave, Kiryas Joel", items: "2 × Inflatable Maze", status: ["scheduled", "Scheduled"] },
];

export default function DesignPreview() {
  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeader
        title="Staff screens (preview)"
        subtitle="Design preview with sample data only. Nothing on this page reads or changes real bookings."
        actions={<PrintButton label="Print this page" />}
      />

      <div className="no-print flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold text-muted">Status colors:</span>
        <Badge tone="scheduled">Scheduled</Badge>
        <Badge tone="pending">Pending</Badge>
        <Badge tone="pending">Out for delivery</Badge>
        <Badge tone="done">Done</Badge>
        <Badge tone="done">Delivered</Badge>
      </div>

      {/* 1. Admin entry form / portal screen */}
      <Section title="1 · Entry form">
        <form className="grid gap-4 sm:grid-cols-2" aria-label="Sample entry form">
          <Field label="Customer name"><input className="input" placeholder="First and last name" disabled /></Field>
          <Field label="Phone"><input className="input" placeholder="(845) 555-0123" disabled /></Field>
          <Field label="Event date"><input className="input" type="date" disabled /></Field>
          <Field label="Rental">
            <select className="input" disabled><option>Choose a rental</option></select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Delivery address" hint="Orange County only."><input className="input" placeholder="House number, street, town" disabled /></Field>
          </div>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <button type="button" className="btn" disabled>Save booking</button>
            <button type="button" className="btn-ghost" disabled>Cancel</button>
          </div>
        </form>
      </Section>

      {/* 2. Secretary worksheet + entry log with a quick log entry row */}
      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Section title="2 · Worksheet · Sunday (sample)" aside={<span className="text-xs text-sky">3 bookings</span>}>
          <div className="hidden sm:block">
            <table className="print-tight w-full text-sm">
              <thead><tr><th className="th">Time</th><th className="th">Customer</th><th className="th">Rental</th><th className="th">Town</th><th className="th">Status</th></tr></thead>
              <tbody>
                {SAMPLE_WORKSHEET.map((r) => (
                  <tr key={r.time} className="even:bg-bg/60">
                    <td className="td font-bold tabular-nums">{r.time}</td><td className="td">{r.customer}</td><td className="td">{r.item}</td><td className="td">{r.town}</td>
                    <td className="td"><Badge tone={r.status[0]}>{r.status[1]}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="space-y-2 sm:hidden">
            {SAMPLE_WORKSHEET.map((r) => (
              <li key={r.time} className="rounded-lg border border-line p-3">
                <div className="flex items-center justify-between"><span className="font-bold tabular-nums">{r.time}</span><Badge tone={r.status[0]}>{r.status[1]}</Badge></div>
                <div className="mt-1 text-sm">{r.customer} · {r.item}</div>
                <div className="text-xs text-muted">{r.town}</div>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Entry log">
          <form className="no-print mb-3 flex gap-2" aria-label="Quick log entry">
            <input className="input" placeholder="Quick note: who, what, when" disabled />
            <button type="button" className="btn shrink-0" disabled aria-label="Add log entry"><Plus className="h-4 w-4" /> Add</button>
          </form>
          <ol className="space-y-3 text-sm">
            {SAMPLE_LOG.map((l) => (
              <li key={l.at} className="border-l-2 border-sky pl-3">
                <div className="text-xs font-bold uppercase tracking-wide text-muted">{l.at} · {l.who}</div>
                <div>{l.note}</div>
              </li>
            ))}
          </ol>
        </Section>
      </div>

      {/* 3. Delivery day timeline */}
      <Section title="3 · Delivery schedule · Sunday (sample)" aside={<span className="text-xs text-sky">Driver: Sample Driver</span>}>
        <ol className="relative space-y-4 border-l-2 border-sky/60 pl-5">
          {SAMPLE_STOPS.map((s) => (
            <li key={s.time} className="relative">
              <span className="absolute -left-[29px] top-3 h-4 w-4 rounded-full border-2 border-white bg-navy ring-2 ring-sky" aria-hidden />
              <article className="card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-bold">
                    <Clock className="h-4 w-4 text-navy" aria-hidden />
                    <span className="tabular-nums">{s.time}</span>
                    <span className="text-muted">· {s.kind}</span>
                  </div>
                  <Badge tone={s.status[0]}>{s.status[1]}</Badge>
                </div>
                <div className="mt-2 text-lg font-bold">{s.customer}</div>
                <div className="mt-0.5 flex items-center gap-1.5 text-sm"><MapPin className="h-4 w-4 text-navy" aria-hidden />{s.address}</div>
                <div className="mt-0.5 text-sm text-muted">{s.items}</div>
                <div className="no-print mt-3 grid grid-cols-1 gap-2 sm:grid-cols-4">
                  <button type="button" className="btn-ghost" disabled><Phone className="h-4 w-4" /> Call</button>
                  <button type="button" className="btn-ghost" disabled><MessageSquareText className="h-4 w-4" /> Send template text</button>
                  <button type="button" className="btn-ghost" disabled><Camera className="h-4 w-4" /> Add photo</button>
                  <button type="button" className="btn-dark" disabled><CheckCircle2 className="h-4 w-4" /> Mark delivered</button>
                </div>
              </article>
            </li>
          ))}
        </ol>
      </Section>
    </div>
  );
}
