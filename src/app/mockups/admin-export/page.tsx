import { FileSpreadsheet, Sheet } from "lucide-react";
import MockBanner from "../MockBanner";

export const metadata = { title: "Admin export mock-up | Hup Up Attractions" };

/** The two sheet buttons as they would appear (not clickable here). Sample data only, no real customers. */
function Buttons({ label }: { label: string }) {
  return (
    <span data-export-mock className="inline-flex flex-wrap items-center gap-2">
      <span className="btn-ghost inline-flex items-center gap-1.5">
        <FileSpreadsheet className="h-4 w-4" aria-hidden /> {label}: Export to Excel
      </span>
      <span className="btn-ghost inline-flex cursor-not-allowed items-center gap-1.5 opacity-50" title="Needs Google sign-in setup first (Abraham's approval)">
        <Sheet className="h-4 w-4" aria-hidden /> Open in Google Sheets
      </span>
    </span>
  );
}

function Screen({ n, title, who, buttons, children }: { n: number; title: string; who: string; buttons: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mx-auto mt-8 max-w-6xl px-4 sm:px-6">
      <p className="mb-2 text-sm font-bold text-muted">
        {n}. {title} · <span className="font-semibold">{who}</span>
      </p>
      <div className="rounded-2xl border border-line bg-bg p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-2xl font-black">{title}</h2>
          <div className="flex flex-wrap gap-2">{buttons}</div>
        </div>
        {children}
      </div>
    </section>
  );
}

const Table = ({ head, rows }: { head: string[]; rows: string[][] }) => (
  <div className="card overflow-x-auto p-4">
    <table className="w-full min-w-[560px] text-sm">
      <thead>
        <tr className="text-left text-muted">{head.map((h) => <th key={h} className="py-2">{h}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-t border-line">{r.map((c, j) => <td key={j} className="py-2">{c}</td>)}</tr>
        ))}
      </tbody>
    </table>
  </div>
);

export default function AdminExportMockup() {
  return (
    <div className="min-h-screen bg-white pb-16 font-sans text-navy">
      <MockBanner title="Admin sheet buttons" note="Where 'Export to Excel' and 'Open in Google Sheets' would go on each admin list. Sample data only. Not on the real admin yet." />

      <Screen n={1} title="All orders" who="Owner" buttons={<><Buttons label="Bookings" /><span className="btn">+ New booking</span></>}>
        <Table head={["Order", "Status", "Event date", "Customer", "Items", "Total"]} rows={[["#1001", "Confirmed", "Nov 15", "Sample Customer", "1 × Jumping Balloon", "$150.00"], ["#1002", "Awaiting payment", "Nov 16", "Sample Customer 2", "1 × Laser Tag", "$250.00"]]} />
      </Screen>

      <Screen n={2} title="Customers" who="Owner and Secretary" buttons={<Buttons label="Customers" />}>
        <Table head={["Name", "Phone", "Bookings", "Last event", "Texts"]} rows={[["Sample Customer", "(845) 555-0100", "3", "Nov 15", "Promos: yes"], ["Sample Customer 2", "(845) 555-0101", "1", "Nov 16", ""]]} />
      </Screen>

      <Screen n={3} title="Dashboard" who="Owner only (money)" buttons={<><Buttons label="Dashboard report" /><Buttons label="Payments" /></>}>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[["Booked revenue", "$4,250"], ["Bookings", "21"], ["Paid", "$3,900"], ["Awaiting payment", "3"]].map(([k, v]) => (
            <div key={k} className="card p-5"><div className="text-sm font-semibold text-muted">{k}</div><div className="mt-1 text-2xl font-black">{v}</div></div>
          ))}
        </div>
        <p className="mt-3 text-sm text-muted">The Excel file has three tabs: Summary, By channel, Top items.</p>
      </Screen>

      <Screen n={4} title="Call log" who="Owner and Secretary" buttons={<Buttons label="Call log" />}>
        <Table head={["When", "Caller", "Outcome", "Order"]} rows={[["Nov 6, 2:14 PM", "(845) 555-0102", "Checked out", "#1001"], ["Nov 6, 3:02 PM", "(845) 555-0103", "Left a voicemail", ""]]} />
      </Screen>

      <Screen n={5} title="Deliveries" who="Owner and Secretary (not drivers)" buttons={<><span className="btn-ghost">← Previous day</span><span className="btn-ghost">Next day →</span><Buttons label="Deliveries and pickups" /></>}>
        <Table head={["Date", "Type", "Order", "Time", "Address"]} rows={[["Nov 15", "Delivery", "#1001", "10:00 AM", "Sample address, Kiryas Joel"], ["Nov 16", "Pickup", "#1001", "", "Sample address, Kiryas Joel"]]} />
      </Screen>

      <section className="mx-auto mt-10 max-w-6xl px-4 text-[15px] sm:px-6">
        <h2 className="text-lg font-black">Notes for Abraham</h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5">
          <li><b>Export to Excel</b> downloads an .xlsx file right away. It needs no new service or account.</li>
          <li><b>Open in Google Sheets</b> needs a one-time Google sign-in setup: a free Google Cloud project with the Google Drive API turned on and a sign-in key added to the website settings. Nothing is set up until you say yes. Until then the button stays greyed out, and you can open the Excel file in Google Sheets yourself.</li>
          <li>Money reports (bookings, payments, dashboard) are Owner-only. Delivery staff get no sheet buttons.</li>
          <li>Expenses split by business and personal accounts: the system has no expense records yet, so that sheet needs to know where the expenses come from first.</li>
        </ul>
      </section>
    </div>
  );
}
