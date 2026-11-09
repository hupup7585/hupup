import Link from "next/link";
import NotActive from "@/components/NotActive";
import { asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { todayISO } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { KIND_LABEL, openBills, openInvoices, reminders, requireBooks, salesTaxPeriods, type EntryKind } from "@/lib/books";
import {
  BOOK_REPORTS,
  BOOK_REPORT_LABEL,
  balanceSheet,
  cashFlow,
  datePresets,
  depreciation,
  entriesBetween,
  expensesByCategory,
  incomeByChannel,
  incomeByItem,
  mileageSummary,
  payablesAging,
  people1099,
  pnl,
  processorView,
  receivablesAging,
  salesTaxSummary,
  threshold1099,
} from "@/lib/books-reports";
import * as A from "./actions";
import * as G from "./gl-actions";
import * as I from "./invoice-actions";
import { KIND_NAME, listDocs, type DocKind } from "@/lib/invoices";
import GeneralLedger from "./Ledger";
import { Card, CategorySelect, Field, FileInput, Grid, MethodSelect, Save, Stat, Table, money } from "./ui";

export const metadata = { title: "Bookkeeping | Hup Up Attractions" };
export const dynamic = "force-dynamic";

const TABS: [string, string][] = [
  ["overview", "Overview"],
  ["income", "Income"],
  ["invoices", "Invoices"],
  ["expenses", "Expenses"],
  ["bills", "Bills I owe"],
  ["processor", "Sola fees"],
  ["bank", "Bank & card"],
  ["tax", "Sales tax"],
  ["equipment", "Equipment"],
  ["people", "Staff & 1099"],
  ["mileage", "Mileage"],
  ["reports", "Reports"],
  ["ledger", "All entries"],
  ["gl", "General ledger"],
  ["settings", "Settings"],
];

type SP = { asOf?: string; account?: string; tab?: string; from?: string; to?: string; group?: string; msg?: string; err?: string; year?: string };

/** Bookkeeping (Abraham T): Owner only. */
export default async function BookkeepingPage({ searchParams }: { searchParams: Promise<SP> }) {
  const staff = await requireBooks();
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "overview";
  const today = todayISO();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? "") ? sp.from! : `${today.slice(0, 4)}-01-01`;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? "") ? sp.to! : today;
  const settings = await getSettings();
  const categories = (await db.select().from(schema.bookCategories).orderBy(asc(schema.bookCategories.sortOrder), asc(schema.bookCategories.name)));
  const activeCats = categories.filter((c) => c.active).map((c) => c.name);

  return (
    <div className="mx-auto max-w-7xl" data-bookkeeping>
      <h1 className="mb-1 text-2xl font-black sm:text-3xl">Bookkeeping</h1>
      <p className="mb-4 text-muted">Owner only. Nothing here is ever deleted: a mistake is fixed with a correction entry, and closed months can be locked.</p>
      <nav className="mb-5 flex flex-wrap gap-2" aria-label="Bookkeeping sections">
        {TABS.map(([k, label]) => (
          <Link key={k} href={`/admin/bookkeeping?tab=${k}`} className={`rounded-full px-3 py-1.5 text-sm font-bold ${k === tab ? "bg-navy text-white" : "bg-white text-navy ring-1 ring-line hover:bg-bg"}`}>
            {label}
          </Link>
        ))}
      </nav>
      {sp.msg && <p className="mb-4 rounded-xl bg-[#E3F8EF] px-4 py-3 text-sm font-semibold text-[#13895C]" role="status">{sp.msg}</p>}
      {sp.err && <p className="mb-4 rounded-xl bg-[#FFE6E4] px-4 py-3 text-sm font-semibold text-[#C83A2F]" role="alert">{sp.err}</p>}
      {tab === "overview" && <Overview today={today} days={Number(settings.bookReminderDays) || 7} />}
      {tab === "income" && <Income cats={activeCats} />}
      {tab === "invoices" && <Invoices today={today} />}
      {tab === "expenses" && <Expenses cats={activeCats} />}
      {tab === "bills" && <Bills cats={activeCats} today={today} />}
      {tab === "processor" && <Processor from={from} to={to} pct={settings.solaFeePercent} fixed={settings.solaFeeCents} />}
      {tab === "bank" && <Bank cats={activeCats} />}
      {tab === "tax" && <Tax year={Number(sp.year) || Number(today.slice(0, 4))} />}
      {tab === "equipment" && <Equipment year={Number(today.slice(0, 4))} />}
      {tab === "people" && <People year={Number(sp.year) || Number(today.slice(0, 4))} />}
      {tab === "mileage" && <Mileage from={from} to={to} />}
      {tab === "reports" && <Reports from={from} to={to} group={(["month", "quarter", "year"].includes(sp.group ?? "") ? sp.group : "month") as "month"} />}
      {tab === "ledger" && <Ledger from={from} to={to} />}
      {tab === "gl" && <GeneralLedger asOf={/^\d{4}-\d{2}-\d{2}$/.test(sp.asOf ?? "") ? sp.asOf! : today} accountId={Number(sp.account) || undefined} from={from} to={to} owner={staff.role === "owner"} />}
      {tab === "settings" && <SettingsTab categories={categories} pct={settings.solaFeePercent} fixed={settings.solaFeeCents} days={settings.bookReminderDays} openingCash={settings.bookOpeningCashCents} openingDate={settings.bookOpeningDate} />}
    </div>
  );
}

function RangeForm({ tab, from, to, extra, group }: { tab: string; from: string; to: string; extra?: React.ReactNode; group?: string }) {
  return (
    <>
    <div className="mb-2 flex flex-wrap gap-2" data-date-presets>
      {datePresets(todayISO()).map((p) => (
        <Link key={p.key} href={`/admin/bookkeeping?tab=${tab}&from=${p.from}&to=${p.to}${group ? `&group=${group}` : ""}`} className={`rounded-full px-3 py-1 text-sm font-semibold ring-1 ring-line ${p.from === from && p.to === to ? "bg-navy text-white" : "bg-white text-navy hover:bg-bg"}`}>
          {p.label}
        </Link>
      ))}
    </div>
    <form className="mb-4 flex flex-wrap items-end gap-3" method="get">
      <input type="hidden" name="tab" value={tab} />
      <Field label="From"><input type="date" name="from" defaultValue={from} className="input" /></Field>
      <Field label="To"><input type="date" name="to" defaultValue={to} className="input" /></Field>
      {extra}
      <button className="btn-dark">Show</button>
    </form>
    </>
  );
}

async function Overview({ today, days }: { today: string; days: number }) {
  const year = today.slice(0, 4);
  const entries = await entriesBetween(`${year}-01-01`, today);
  const [p] = pnl(entries, "year");
  const month = pnl(entries.filter((e) => e.entryDate.startsWith(today.slice(0, 7))), "month")[0];
  const due = await reminders(days, today);
  const ar = (await openInvoices()).reduce((s, i) => s + Math.max(0, i.balanceCents), 0);
  const ap = (await openBills()).reduce((s, b) => s + Math.max(0, b.balanceCents), 0);
  return (
    <>
      <Card title={`${year} so far`}>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
          <Stat label="Income" value={money(p?.totalIncome ?? 0)} note="before sales tax" />
          <Stat label="Expenses" value={money(p?.totalExpenses ?? 0)} />
          <Stat label="Net profit" value={money(p?.net ?? 0)} />
          <Stat label="This month's profit" value={money(month?.net ?? 0)} />
          <Stat label="Customers owe" value={money(ar)} note="open invoices" />
          <Stat label="I owe" value={money(ap)} note="open bills" />
        </div>
      </Card>
      <Card title="Reminders" note={`Bills, sales tax and estimated tax due in the next ${days} days, overdue items, and recurring expenses. Shown here and on this page only (no texts or emails are sent).`}>
        <Table
          head={["Due", "What", "Amount", ""]}
          empty="Nothing due soon."
          rows={due.map((r) => [r.due, r.label, r.cents ? money(r.cents) : "", r.overdue ? <b className="text-[#C83A2F]">Overdue</b> : "Due soon"])}
        />
      </Card>
    </>
  );
}

function EntryForm({ tab, kinds, cats, children }: { tab: string; kinds: EntryKind[]; cats: string[]; children?: React.ReactNode }) {
  return (
    <form action={A.addEntryAction} className="space-y-3">
      <input type="hidden" name="tab" value={tab} />
      <Grid>
        <Field label="Type">
          <select name="kind" className="input" defaultValue={kinds[0]}>
            {kinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </Field>
        <Field label="Date"><input type="date" name="date" defaultValue={todayISO()} className="input" required /></Field>
        <Field label="Amount ($)"><input name="amount" inputMode="decimal" placeholder="0.00" className="input" required /></Field>
        <Field label="Payment method"><MethodSelect /></Field>
        <Field label="Check number"><input name="checkNo" className="input" /></Field>
        <Field label={tab === "income" ? "From (customer, school)" : "Vendor"}><input name="party" className="input" /></Field>
        <Field label="Category"><CategorySelect categories={cats} /></Field>
        <Field label="Booking # (if any)"><input name="orderId" inputMode="numeric" className="input" /></Field>
        {children}
        <Field label="Notes" wide><input name="notes" className="input" placeholder="Never type a card number" /></Field>
        <Field label="Receipt (photo or PDF, optional)" wide><FileInput /></Field>
      </Grid>
      <Save />
    </form>
  );
}

async function recent(kinds: string[], limit = 30) {
  const all = await db.select().from(schema.bookEntries).orderBy(desc(schema.bookEntries.id)).limit(400);
  return all.filter((e) => kinds.includes(e.kind)).slice(0, limit);
}

function EntryRows({ entries, tab }: { entries: (typeof schema.bookEntries.$inferSelect)[]; tab: string }) {
  return (
    <Table
      head={["#", "Date", "Type", "From / to", "Method", "Amount", "Split", "Booking", "Receipt", "Correct"]}
      empty="No entries yet."
      minWidth={980}
      rows={entries.map((e) => [
        e.id,
        e.entryDate,
        <>{KIND_LABEL[e.kind as EntryKind] ?? e.kind}{e.category ? <span className="text-muted"> · {e.category}</span> : null}{e.source === "auto" ? <span className="ml-1 rounded bg-bg px-1 text-xs">auto</span> : null}</>,
        e.party || e.personName || "—",
        <>{e.method ?? "—"}{e.checkNo ? ` #${e.checkNo}` : ""}</>,
        <b>{money(e.amountCents)}</b>,
        e.rentalCents || e.deliveryCents || e.taxCents || e.tipCents ? <span className="text-xs text-muted">rental {money(e.rentalCents)} · delivery {money(e.deliveryCents)} · tax {money(e.taxCents)} · tip {money(e.tipCents)}</span> : "",
        e.orderId ? <Link className="text-navy underline" href={`/admin/orders/${e.orderId}`}>#{e.orderId}</Link> : "—",
        e.fileId ? <a className="text-navy underline" href={`/admin/bookkeeping/files/${e.fileId}`} target="_blank">View</a> : "—",
        e.correctsId ? <span className="text-xs text-muted">corrects #{e.correctsId}</span> : (
          <form action={A.reverseEntryAction} className="flex gap-1">
            <input type="hidden" name="id" value={e.id} />
            <input type="hidden" name="tab" value={tab} />
            <input name="reason" placeholder="Why" className="input w-24 py-1 text-xs" />
            <button className="text-xs font-bold text-[#C83A2F]">Correct</button>
          </form>
        ),
      ])}
    />
  );
}

async function Income({ cats }: { cats: string[] }) {
  return (
    <>
      <Card title="Record a payment" note="Paid bookings (phone line and staff New booking) are recorded automatically and split into rental, delivery, sales tax and tip. Use this for cash, checks, Zelle and other payments, deposits, refunds and cancellation fees.">
        <EntryForm tab="income" kinds={["income", "deposit", "refund", "cancellation_fee"]} cats={["Bookings", "Invoices", ...cats]}>
          <Field label="Sales tax included ($)"><input name="tax" inputMode="decimal" className="input" placeholder="0.00" /></Field>
          <Field label="Delivery fee included ($)"><input name="delivery" inputMode="decimal" className="input" placeholder="0.00" /></Field>
          <Field label="Tip ($)"><input name="tip" inputMode="decimal" className="input" placeholder="0.00" /></Field>
          <Field label="Tax exempt sale"><input type="checkbox" name="taxExempt" className="h-5 w-5" /></Field>
        </EntryForm>
      </Card>
      <Card title="Recent income, deposits, refunds and cancellation fees">
        <EntryRows entries={await recent(["income", "deposit", "refund", "cancellation_fee"])} tab="income" />
      </Card>
    </>
  );
}

async function Invoices({ today }: { today: string }) {
  const docs = await listDocs();
  const invoices = docs.filter((d) => d.kind === "invoice");
  const ar = await receivablesAging(today);
  const buckets = ["current", "1-30", "31-60", "61-90", "90+"] as const;
  const customers = [...new Set(docs.filter((d) => d.status === "open").map((d) => d.customerName))].sort();
  return (
    <>
      <p data-not-active="invoice-email" className="mb-4 rounded-xl border border-[#E8B400]/50 bg-[#FFF8E1] px-4 py-3 text-sm text-[#5C4600]">
        <b>Not active yet:</b> emailing invoices, reminders and online invoice payment. Invoice emails and reminders wait for Abraham&rsquo;s approval of the wording customers see; online payment needs Sola connected. Print or save the PDF and send it yourself for now.
      </p>
      <Card title="Make one from a booking" note="Copies the booking's items, delivery fee and sales tax exactly as charged. Saved as a draft for you to check.">
        <form action={I.fromBookingAction} className="flex flex-wrap items-end gap-3">
          <Field label="Booking #"><input name="orderId" inputMode="numeric" className="input w-28" required /></Field>
          <Field label="Type"><select name="kind" className="input"><option value="invoice">Invoice</option><option value="quote">Quote</option></select></Field>
          <Field label="Payment terms (days)"><input name="termsDays" type="number" min={0} defaultValue={0} className="input w-24" /></Field>
          <Save label="Make draft" />
        </form>
      </Card>
      <Card title="New invoice, quote or credit note" note="Schools and institutions that pay by check: set payment terms. Tax-exempt customers: enter the certificate number (attach the certificate on the old form below if needed).">
        <form action={I.createDocAction} className="space-y-3">
          <Grid>
            <Field label="Type"><select name="kind" className="input"><option value="invoice">Invoice</option><option value="quote">Quote</option><option value="credit_note">Credit note</option></select></Field>
            <Field label="Customer or school"><input name="customerName" list="book-customers" className="input" required /><datalist id="book-customers">{customers.map((c) => <option key={c} value={c} />)}</datalist></Field>
            <Field label="Email"><input name="customerEmail" type="email" className="input" /></Field>
            <Field label="Phone"><input name="customerPhone" className="input" /></Field>
            <Field label="Billing address" wide><input name="billingAddress" className="input" /></Field>
            <Field label="Date"><input type="date" name="issueDate" defaultValue={today} className="input" /></Field>
            <Field label="Payment terms (days)"><input name="termsDays" type="number" min={0} defaultValue={0} className="input" /></Field>
            <Field label="Booking # (optional)"><input name="orderId" inputMode="numeric" className="input" /></Field>
            <Field label="Credit note for invoice">
              <select name="relatedInvoiceId" className="input" defaultValue="">
                <option value="">—</option>
                {invoices.filter((i) => i.status === "open").map((i) => <option key={i.id} value={i.id}>{i.number ?? `#${i.id}`} · {i.customerName}</option>)}
              </select>
            </Field>
          </Grid>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr><th className="th">Description</th><th className="th">Qty</th><th className="th">Price each ($)</th></tr></thead>
              <tbody>
                {Array.from({ length: 5 }, (_, i) => (
                  <tr key={i}>
                    <td className="td"><input name={`desc${i}`} className="input py-1" /></td>
                    <td className="td w-24"><input name={`qty${i}`} type="number" min={1} defaultValue={1} className="input py-1" /></td>
                    <td className="td w-40"><input name={`price${i}`} inputMode="decimal" className="input py-1" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Grid>
            <Field label="Discount ($)"><input name="discount" inputMode="decimal" className="input" /></Field>
            <Field label="Sales tax ($, as charged)"><input name="tax" inputMode="decimal" className="input" /></Field>
            <Field label="Deposit required ($)"><input name="deposit" inputMode="decimal" className="input" /></Field>
            <Field label="Tax exempt"><input type="checkbox" name="taxExempt" className="h-5 w-5" /></Field>
            <Field label="Exempt certificate #"><input name="exemptCertNo" className="input" /></Field>
            <Field label="Notes on the document" wide><input name="notes" className="input" /></Field>
          </Grid>
          <label className="block text-sm"><input type="checkbox" name="issue" /> Issue now (otherwise it&rsquo;s saved as a draft)</label>
          <Save label="Save" />
        </form>
      </Card>
      <Card title="Receivables aging" note="What customers owe on issued invoices, by how late it is.">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          {buckets.map((b) => <Stat key={b} label={b === "current" ? "Not due yet" : `${b} days late`} value={money(ar.filter((x) => x.bucket === b).reduce((s, x) => s + x.balanceCents, 0))} />)}
        </div>
      </Card>
      <Card title="Invoices, quotes and credit notes">
        <Table
          head={["Number", "Type", "Customer", "Date", "Due", "Total", "Balance", "Status", "Record a payment"]}
          empty="Nothing yet."
          minWidth={1150}
          rows={docs.map((d) => [
            <a key="n" className="font-bold text-navy underline" href={`/admin/bookkeeping/invoice/${d.id}`}>{d.number ?? `#${d.id}`}</a>,
            KIND_NAME[d.kind as DocKind] ?? d.kind,
            <a key="c" className="underline" href={`/admin/bookkeeping/statement?c=${encodeURIComponent(d.customerName)}`}>{d.customerName}</a>,
            d.issueDate,
            d.kind === "invoice" ? d.dueDate : "—",
            money(d.amountCents),
            d.kind === "invoice" ? <b key="b">{money(d.balanceCents)}</b> : "—",
            <span key="s" className={d.display === "Overdue" ? "font-bold text-[#C83A2F]" : d.display === "Paid" ? "font-bold text-[#13895C]" : ""}>{d.display}</span>,
            d.kind === "invoice" && d.status === "open" && d.balanceCents > 0 ? (
              <form key="p" action={A.payInvoiceAction} className="flex flex-wrap gap-1">
                <input type="hidden" name="invoiceId" value={d.id} />
                <input type="date" name="date" defaultValue={today} className="input w-36 py-1 text-xs" />
                <input name="amount" placeholder="Amount" className="input w-20 py-1 text-xs" />
                <select name="method" className="input w-20 py-1 text-xs" defaultValue="check"><option value="check">Check</option><option value="zelle">Zelle</option><option value="cash">Cash</option><option value="bank">Bank</option><option value="other">Other</option></select>
                <input name="checkNo" placeholder="Check #" className="input w-20 py-1 text-xs" />
                <button className="text-xs font-bold text-navy">Save</button>
              </form>
            ) : "",
          ])}
        />
      </Card>
    </>
  );
}

async function Expenses({ cats }: { cats: string[] }) {
  const rec = await db.select().from(schema.bookRecurring).orderBy(asc(schema.bookRecurring.nextDate));
  const projects = await db.select({ id: schema.taskProjects.id, name: schema.taskProjects.name }).from(schema.taskProjects).where(eq(schema.taskProjects.status, "open"));
  const products = await db.select({ id: schema.products.id, name: schema.products.name }).from(schema.products).orderBy(asc(schema.products.name));
  return (
    <>
      <Card title="Record an expense" note="Repairs on a rental item: choose the item so it counts against that item's profit.">
        <EntryForm tab="expenses" kinds={["expense"]} cats={cats}>
          <Field label="Project (Tasks)">
            <select name="projectId" className="input" defaultValue="">
              <option value="">—</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Rental item (repairs)">
            <select name="productId" className="input" defaultValue="">
              <option value="">—</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
        </EntryForm>
      </Card>
      <Card title="Recurring expenses and subscriptions" note="On each date, press Paid (records the expense) or Owed (adds a bill). The date then moves to the next one.">
        <form action={A.addRecurringAction} className="mb-4 space-y-3">
          <Grid>
            <Field label="Vendor or subscription"><input name="vendor" className="input" required /></Field>
            <Field label="Amount ($)"><input name="amount" inputMode="decimal" className="input" required /></Field>
            <Field label="How often">
              <select name="frequency" className="input" defaultValue="monthly"><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option></select>
            </Field>
            <Field label="Next date"><input type="date" name="nextDate" className="input" required /></Field>
            <Field label="Category"><CategorySelect categories={cats} /></Field>
            <Field label="Payment method"><MethodSelect /></Field>
          </Grid>
          <Save label="Add recurring expense" />
        </form>
        <Table
          head={["Vendor", "Amount", "How often", "Next", "Category", "Record", ""]}
          empty="No recurring expenses yet."
          rows={rec.map((r) => [
            r.vendor,
            money(r.amountCents),
            r.frequency,
            r.nextDate,
            r.category ?? "—",
            r.active ? (
              <div className="flex gap-2">
                <form action={A.recordRecurringAction}><input type="hidden" name="id" value={r.id} /><button className="text-xs font-bold text-navy">Paid</button></form>
                <form action={A.recordRecurringAction}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="as" value="bill" /><button className="text-xs font-bold text-navy">Owed</button></form>
              </div>
            ) : <span className="text-muted">stopped</span>,
            r.active ? <form action={A.stopRecurringAction}><input type="hidden" name="id" value={r.id} /><button className="text-xs font-bold text-[#C83A2F]">Stop</button></form> : "",
          ])}
        />
      </Card>
      <Card title="Recent expenses">
        <EntryRows entries={await recent(["expense", "processor_fee"])} tab="expenses" />
      </Card>
    </>
  );
}

async function Bills({ cats, today }: { cats: string[]; today: string }) {
  const bills = await db.select().from(schema.bookBills).orderBy(desc(schema.bookBills.id)).limit(100);
  const open = new Map((await openBills()).map((b) => [b.id, b]));
  const aging = await payablesAging(today);
  const buckets = ["current", "1-30", "31-60", "61-90", "90+"] as const;
  return (
    <>
      <Card title="New bill">
        <form action={A.addBillAction} className="space-y-3">
          <Grid>
            <Field label="Vendor"><input name="vendor" className="input" required /></Field>
            <Field label="Amount ($)"><input name="amount" inputMode="decimal" className="input" required /></Field>
            <Field label="Bill date"><input type="date" name="billDate" defaultValue={today} className="input" /></Field>
            <Field label="Due date"><input type="date" name="dueDate" className="input" required /></Field>
            <Field label="Category"><CategorySelect categories={cats} /></Field>
            <Field label="Bill (PDF or photo)"><FileInput /></Field>
            <Field label="Notes" wide><input name="notes" className="input" /></Field>
          </Grid>
          <Save label="Save bill" />
        </form>
      </Card>
      <Card title="Payables aging" note="What I owe, by how late it is.">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          {buckets.map((b) => <Stat key={b} label={b === "current" ? "Not due yet" : `${b} days late`} value={money(aging.filter((x) => x.bucket === b).reduce((s, x) => s + x.balanceCents, 0))} />)}
        </div>
      </Card>
      <Card title="Bills">
        <Table
          head={["#", "Vendor", "Due", "Amount", "Paid", "Balance", "Pay", "Void"]}
          empty="No bills yet."
          minWidth={1000}
          rows={bills.map((b) => {
            const o = open.get(b.id);
            const late = o && o.balanceCents > 0 && b.dueDate < today;
            return [
              b.id,
              <>{b.vendor}{b.fileId ? <> · <a className="text-navy underline" href={`/admin/bookkeeping/files/${b.fileId}`} target="_blank">bill</a></> : null}</>,
              <span className={late ? "font-bold text-[#C83A2F]" : ""}>{b.dueDate}{late ? " · overdue" : ""}</span>,
              money(b.amountCents),
              o ? money(o.paidCents) : "—",
              b.status === "void" ? <span className="text-muted">void</span> : <b>{money(o?.balanceCents ?? 0)}</b>,
              b.status === "open" && (o?.balanceCents ?? 0) > 0 ? (
                <form action={A.payBillAction} className="flex flex-wrap gap-1">
                  <input type="hidden" name="billId" value={b.id} />
                  <input type="date" name="date" defaultValue={today} className="input w-36 py-1 text-xs" />
                  <input name="amount" placeholder="Amount" className="input w-20 py-1 text-xs" />
                  <MethodSelect />
                  <button className="text-xs font-bold text-navy">Pay</button>
                </form>
              ) : "—",
              b.status === "open" ? (
                <form action={A.voidBillAction} className="flex gap-1"><input type="hidden" name="id" value={b.id} /><input name="reason" placeholder="Why" className="input w-20 py-1 text-xs" /><button className="text-xs font-bold text-[#C83A2F]">Void</button></form>
              ) : "—",
            ];
          })}
        />
      </Card>
    </>
  );
}

async function Processor({ from, to, pct, fixed }: { from: string; to: string; pct: string; fixed: string }) {
  const v = processorView(await entriesBetween(from, to), pct, fixed);
  return (
    <>
      <RangeForm tab="processor" from={from} to={to} />
      <NotActive k="payments" />
      <Card title="Sola payments, fees and net deposits" note={`Estimated with your Sola rate (${pct}% + ${money(Number(fixed) || 0)} per payment; change it under Settings). Enter the actual monthly fees from the Sola statement as a "Processor fee" expense so the books match the bank.`}>
        <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Card payments" value={money(v.grossCents)} />
          <Stat label="Estimated fees" value={money(v.estFeesCents)} />
          <Stat label="Expected deposits" value={money(v.grossCents - v.estFeesCents)} />
          <Stat label="Actual fees entered" value={money(v.actualFeesCents)} />
        </div>
        <Table
          head={["Date", "Booking", "Sola ref", "Payment", "Est. fee", "Net deposit"]}
          empty="No Sola payments in this range."
          rows={v.rows.map((r) => [r.date, r.orderId ? <Link className="text-navy underline" href={`/admin/orders/${r.orderId}`}>#{r.orderId}</Link> : "—", r.ref ?? "—", money(r.grossCents), money(r.feeCents), <b>{money(r.netCents)}</b>])}
        />
      </Card>
    </>
  );
}

async function Bank({ cats }: { cats: string[] }) {
  const lines = await db.select().from(schema.bookBankLines).orderBy(desc(schema.bookBankLines.lineDate), desc(schema.bookBankLines.id)).limit(300);
  const unmatched = lines.filter((l) => l.status === "unmatched");
  return (
    <>
      <Card title="Upload a statement" note="Download the CSV from your bank or card website and upload it here. Each line is matched to the books automatically (same amount within 5 days, or a Sola batch deposit). Lines already uploaded are skipped.">
        <form action={A.importStatementAction} className="flex flex-wrap items-end gap-3">
          <Field label="Account">
            <select name="account" className="input"><option value="bank">Bank account</option><option value="card">Credit card</option></select>
          </Field>
          <Field label="CSV file"><input type="file" name="file" accept=".csv,text/csv" className="input py-2 text-sm" required /></Field>
          <Save label="Upload and match" />
        </form>
        <form action={A.autoMatchAction} className="mt-3"><button className="text-sm font-bold text-navy underline">Try matching again</button></form>
      </Card>
      <Card title={`Not matched (${unmatched.length})`} note="Match by hand with the entry number(s) from All entries, add the missing income or expense first, or mark a line as ignored (for example a transfer between your own accounts).">
        <Table
          head={["Date", "Account", "Description", "Amount", "Match"]}
          empty="Everything is matched."
          minWidth={900}
          rows={unmatched.map((l) => [
            l.lineDate,
            l.account,
            l.description,
            <b className={l.amountCents < 0 ? "text-[#C83A2F]" : ""}>{money(l.amountCents)}</b>,
            <div className="flex flex-wrap gap-2">
              <form action={A.matchLineAction} className="flex gap-1"><input type="hidden" name="id" value={l.id} /><input name="entryIds" placeholder="Entry #" className="input w-24 py-1 text-xs" /><button className="text-xs font-bold text-navy">Match</button></form>
              <form action={A.matchLineAction}><input type="hidden" name="id" value={l.id} /><input type="hidden" name="ignore" value="1" /><button className="text-xs font-bold text-muted">Ignore</button></form>
              <form action={A.categorizeLineAction} className="flex gap-1">
                <input type="hidden" name="id" value={l.id} />
                <select name="category" className="input w-36 py-1 text-xs" defaultValue="" aria-label="Category">
                  <option value="">Category…</option>
                  {(l.amountCents < 0 ? cats : ["Bookings", "Invoices", "Other income"]).map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <button className="text-xs font-bold text-navy">Add to books</button>
              </form>
            </div>,
          ])}
        />
      </Card>
      <Card title="Matched and ignored">
        <Table head={["Date", "Account", "Description", "Amount", "Matched to"]} empty="None yet." minWidth={800} rows={lines.filter((l) => l.status !== "unmatched").map((l) => [l.lineDate, l.account, l.description, money(l.amountCents), <span className="text-xs">{l.status === "ignored" ? `Ignored: ${l.matchNote ?? ""}` : l.matchNote}</span>])} />
      </Card>
    </>
  );
}

async function Tax({ year }: { year: number }) {
  const periods = salesTaxPeriods(year);
  const sums = await Promise.all(periods.map((p) => salesTaxSummary(p.from, p.to)));
  return (
    <>
      <form className="mb-4 flex items-end gap-3" method="get">
        <input type="hidden" name="tab" value="tax" />
        <Field label="Year"><input name="year" type="number" defaultValue={year} className="input w-28" /></Field>
        <button className="btn-dark">Show</button>
      </form>
      {periods.map((p, i) => (
        <Card key={p.from} title={`NY sales tax: ${p.label}`} note={`Quarterly return due ${p.due}. Amounts below are what the books show; the return itself is filed on NY Business Online Services.`}>
          <div className="mb-3 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Stat label="Taxable sales" value={money(sums[i].taxableCents)} />
            <Stat label="Tax-exempt sales" value={money(sums[i].exemptCents)} />
            <Stat label="Sales tax collected" value={money(sums[i].taxCents)} />
          </div>
          <Table head={["County", "Taxable sales", "Tax-exempt sales", "Tax collected"]} empty="No sales in this period." rows={sums[i].rows.map((r) => [r.county, money(r.taxableCents), money(r.exemptCents), money(r.taxCents)])} />
          <a className="mt-3 inline-block text-sm font-bold text-navy underline" href={`/admin/bookkeeping/print?report=sales-tax&from=${p.from}&to=${p.to}`} target="_blank">Printable filing summary</a>
        </Card>
      ))}
    </>
  );
}

async function Equipment({ year }: { year: number }) {
  const products = await db.select({ id: schema.products.id, name: schema.products.name }).from(schema.products).orderBy(asc(schema.products.name));
  const all = await entriesBetween("2000-01-01", todayISO());
  const profit = await incomeByItem(all);
  const dep = await depreciation(year);
  return (
    <>
      <Card title="Add equipment" note="Each rental item's purchase cost and date. Repairs are expenses with the item chosen.">
        <form action={A.addEquipmentAction} className="space-y-3">
          <Grid>
            <Field label="Rental item">
              <select name="productId" className="input" defaultValue="">
                <option value="">— other equipment —</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Name (other equipment)"><input name="name" className="input" placeholder="e.g. Delivery trailer" /></Field>
            <Field label="Purchase date"><input type="date" name="purchaseDate" className="input" required /></Field>
            <Field label="Cost per unit ($)"><input name="cost" inputMode="decimal" className="input" required /></Field>
            <Field label="Quantity"><input name="qty" type="number" min={1} defaultValue={1} className="input" /></Field>
            <Field label="Years to depreciate"><input name="lifeYears" type="number" min={1} defaultValue={5} className="input" /></Field>
            <Field label="Notes" wide><input name="notes" className="input" /></Field>
          </Grid>
          <Save />
        </form>
      </Card>
      <Card title="Profit per item (all time)">
        <Table head={["Item", "Rentals", "Income", "Repairs", "Purchase cost", "Profit"]} empty="No rentals yet." rows={profit.map((r) => [r.name, r.rentals, money(r.incomeCents), money(r.repairsCents), money(r.costCents), <b>{money(r.profitCents)}</b>])} />
      </Card>
      <Card title={`Depreciation list ${year} (for the accountant)`} note="Straight-line, by month of purchase. Your accountant chooses the actual tax method.">
        <Table head={["Item", "Purchased", "Qty", "Cost", "Years", `${year}`, "Accumulated", "Book value"]} empty="No equipment entered yet." rows={dep.map((q) => [q.name, q.purchaseDate, q.qty, money(q.totalCostCents), q.lifeYears, money(q.thisYearCents), money(q.accumulatedCents), money(q.bookValueCents)])} />
      </Card>
    </>
  );
}

async function People({ year }: { year: number }) {
  const people = await people1099(year);
  const staff = await db.select({ name: schema.adminUsers.name }).from(schema.adminUsers).where(eq(schema.adminUsers.active, true));
  return (
    <>
      <Card title="Pay a staff member or contractor">
        <form action={A.addEntryAction} className="space-y-3">
          <input type="hidden" name="tab" value="people" />
          <input type="hidden" name="kind" value="contractor" />
          <Grid>
            <Field label="Person">
              <input name="personName" list="book-people" className="input" required />
              <datalist id="book-people">{staff.map((s) => <option key={s.name} value={s.name} />)}</datalist>
            </Field>
            <Field label="Date"><input type="date" name="date" defaultValue={todayISO()} className="input" /></Field>
            <Field label="Amount ($)"><input name="amount" inputMode="decimal" className="input" required /></Field>
            <Field label="Payment method"><MethodSelect /></Field>
            <Field label="Check number"><input name="checkNo" className="input" /></Field>
            <Field label="Notes" wide><input name="notes" className="input" /></Field>
          </Grid>
          <Save />
        </form>
      </Card>
      <Card title={`${year} totals per person`} note={`1099-NEC is generally needed for a person paid $${(threshold1099(year) / 100).toLocaleString()} or more in the year (confirm with your accountant).`}>
        <form className="mb-3 flex items-end gap-3" method="get"><input type="hidden" name="tab" value="people" /><Field label="Year"><input name="year" type="number" defaultValue={year} className="input w-28" /></Field><button className="btn-dark">Show</button></form>
        <Table head={["Person", "Payments", "Total", "1099"]} empty="No payments this year." rows={people.map((p) => [p.name, p.payments, money(p.cents), p.needs1099 ? <b>Needed</b> : "No"])} />
      </Card>
    </>
  );
}

async function Mileage({ from, to }: { from: string; to: string }) {
  const m = await mileageSummary(from, to);
  return (
    <>
      <Card title="Log a trip">
        <form action={A.addMileageAction} className="space-y-3">
          <Grid>
            <Field label="Date"><input type="date" name="tripDate" defaultValue={todayISO()} className="input" /></Field>
            <Field label="Miles"><input name="miles" inputMode="decimal" className="input" required /></Field>
            <Field label="Vehicle"><input name="vehicle" className="input" /></Field>
            <Field label="Driver"><input name="driver" className="input" /></Field>
            <Field label="Purpose"><input name="purpose" defaultValue="Delivery" className="input" /></Field>
            <Field label="Booking #"><input name="orderId" inputMode="numeric" className="input" /></Field>
            <Field label="Notes" wide><input name="notes" className="input" /></Field>
          </Grid>
          <Save />
        </form>
      </Card>
      <RangeForm tab="mileage" from={from} to={to} />
      <Card title={`Trips: ${(m.totalTenths / 10).toLocaleString()} miles`} note={m.byVehicle.map((v) => `${v.vehicle}: ${(v.tenths / 10).toLocaleString()} mi`).join(" · ") || undefined}>
        <Table
          head={["Date", "Vehicle", "Driver", "Miles", "Purpose", "Booking", "Correct"]}
          empty="No trips in this range."
          rows={m.trips.map((t) => [
            t.tripDate,
            t.vehicle ?? "—",
            t.driver ?? "—",
            (t.milesTenths / 10).toFixed(1),
            <>{t.purpose}{t.notes ? <span className="text-muted"> · {t.notes}</span> : null}</>,
            t.orderId ? `#${t.orderId}` : "—",
            t.correctsId ? "" : <form action={A.reverseMileageAction} className="flex gap-1"><input type="hidden" name="id" value={t.id} /><input name="reason" placeholder="Why" className="input w-20 py-1 text-xs" /><button className="text-xs font-bold text-[#C83A2F]">Correct</button></form>,
          ])}
        />
      </Card>
    </>
  );
}

async function Reports({ from, to, group }: { from: string; to: string; group: "month" | "quarter" | "year" }) {
  const entries = await entriesBetween(from, to);
  const rows = pnl(entries, group);
  const cats = [...new Set(rows.flatMap((r) => Object.keys(r.expenses)))].sort();
  const flow = cashFlow(entries);
  const byCat = expensesByCategory(entries);
  const byCh = await incomeByChannel(entries);
  const byItem = await incomeByItem(entries);
  const ar = await receivablesAging(to);
  const q = (r: string, f = "xlsx") => `/api/admin/books/export?report=${r}&from=${from}&to=${to}&group=${group}&format=${f}`;
  return (
    <>
      <RangeForm
        tab="reports"
        from={from}
        to={to}
        group={group}
        extra={
          <Field label="Group by">
            <select name="group" defaultValue={group} className="input"><option value="month">Month</option><option value="quarter">Quarter</option><option value="year">Year</option></select>
          </Field>
        }
      />
      <Card title="Download" note="Excel and CSV for every report; QuickBooks Online (bank-transactions CSV) and QuickBooks Desktop (IIF) for all entries; printable pages to save as PDF.">
        <Table
          head={["Report", "Excel", "CSV", "Print / PDF"]}
          empty=""
          minWidth={560}
          rows={[
            ...BOOK_REPORTS.map((r) => [BOOK_REPORT_LABEL[r], <a className="text-navy underline" href={q(r)}>Excel</a>, <a className="text-navy underline" href={q(r, "csv")}>CSV</a>, <a className="text-navy underline" href={`/admin/bookkeeping/print?report=${r}&from=${from}&to=${to}&group=${group}`} target="_blank">Print</a>]),
            ["QuickBooks", <a className="text-navy underline" href={q("ledger", "qbo")}>QuickBooks Online CSV</a>, <a className="text-navy underline" href={q("ledger", "iif")}>QuickBooks Desktop IIF</a>, ""],
          ]}
        />
      </Card>
      <BalanceSheetCard to={to} />
      <Card title="Profit and loss">
        <Table
          head={["Period", "Income", ...cats, "Processor fees", "Staff", "Expenses", "Net profit", "Sales tax collected"]}
          empty="No entries in this range."
          minWidth={800}
          rows={rows.map((r) => [r.period, money(r.totalIncome), ...cats.map((c) => money(r.expenses[c] ?? 0)), money(r.processorFees), money(r.contractors), money(r.totalExpenses), <b>{money(r.net)}</b>, money(r.taxCollected)])}
        />
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Cash flow"><Table head={["Month", "In", "Out", "Net", "Running"]} empty="—" minWidth={420} rows={flow.map((r) => [r.month, money(r.moneyIn), money(r.moneyOut), money(r.net), money(r.running)])} /></Card>
        <Card title="Expenses by category"><Table head={["Category", "Amount"]} empty="—" minWidth={300} rows={byCat.map((r) => [r.category, money(r.cents)])} /></Card>
        <Card title="Income by channel" note="The website has no online booking; payments for phone bookings made on the website's pay page count under Phone line.">
          <Table head={["Channel", "Income"]} empty="—" minWidth={300} rows={byCh.map((r) => [r.channel, money(r.cents)])} />
        </Card>
        <Card title="Receivables aging"><Table head={["Invoice", "Customer", "Balance", "Aging"]} empty="Nothing owed." minWidth={400} rows={ar.map((i) => [`#${i.id}`, i.customerName, money(i.balanceCents), i.bucket])} /></Card>
      </div>
      <Card title="Income by item"><Table head={["Item", "Rentals", "Income", "Repairs", "Profit"]} empty="—" rows={byItem.map((r) => [r.name, r.rentals, money(r.incomeCents), money(r.repairsCents), money(r.profitCents)])} /></Card>
    </>
  );
}

async function BalanceSheetCard({ to }: { to: string }) {
  const b = await balanceSheet(to);
  const row = (label: string, v: number, strong = false) => [strong ? <b key="l">{label}</b> : label, strong ? <b key="v">{money(v)}</b> : money(v)];
  return (
    <Card title={`Balance sheet as of ${to}`} note={b.openingDate ? `Cash starts from your opening balance on ${b.openingDate}.` : "Set your opening cash balance under Settings so cash matches the bank."}>
      <div className="grid gap-5 md:grid-cols-2" data-balance-sheet>
        <Table head={["Assets", ""]} empty="" minWidth={300} rows={[row("Cash", b.cash), row("Customers owe (open invoices)", b.ar), row("Equipment (book value)", b.equipment), row("Total assets", b.assets, true)]} />
        <Table head={["Liabilities and equity", ""]} empty="" minWidth={300} rows={[row("Bills I owe", b.ap), row("Sales tax collected, not yet paid", b.taxPayable), row("Total liabilities", b.liabilities, true), row("Owner's equity", b.equity, true)]} />
      </div>
    </Card>
  );
}

async function Ledger({ from, to }: { from: string; to: string }) {
  const entries = (await entriesBetween(from, to)).reverse();
  return (
    <>
      <RangeForm tab="ledger" from={from} to={to} />
      <Card title={`All entries (${entries.length})`} note="Every money movement. To fix a mistake, press Correct: a new entry with the opposite amount is added and both stay on record.">
        <EntryRows entries={entries} tab="ledger" />
      </Card>
    </>
  );
}

async function SettingsTab({ categories, pct, fixed, days, openingCash, openingDate }: { categories: (typeof schema.bookCategories.$inferSelect)[]; pct: string; fixed: string; days: string; openingCash: string; openingDate: string }) {
  const locks = await db.select().from(schema.bookLocks).orderBy(desc(schema.bookLocks.month));
  return (
    <>
      <Card title="Sola rate and reminders">
        <form action={A.saveBookSettingsAction} className="space-y-3">
          <Grid>
            <Field label="Sola rate (%)"><input name="solaFeePercent" defaultValue={pct} className="input" /></Field>
            <Field label="Sola fee per payment ($)"><input name="solaFeeFixed" defaultValue={((Number(fixed) || 0) / 100).toFixed(2)} className="input" /></Field>
            <Field label="Remind me this many days before"><input name="bookReminderDays" type="number" defaultValue={days} className="input" /></Field>
            <Field label="Opening cash balance ($)"><input name="openingCash" defaultValue={((Number(openingCash) || 0) / 100).toFixed(2)} className="input" /></Field>
            <Field label="Opening balance date"><input type="date" name="openingDate" defaultValue={openingDate} className="input" /></Field>
          </Grid>
          <Save />
        </form>
      </Card>
      <Card title="Expense categories" note="Rename, turn off, or add categories. Categories are never deleted, so old entries keep theirs.">
        <form action={A.addCategoryAction} className="mb-4 flex flex-wrap items-end gap-3">
          <Field label="New category"><input name="name" className="input" required /></Field>
          <Save label="Add" />
        </form>
        <Table
          head={["Category", "On", ""]}
          empty="—"
          minWidth={420}
          rows={categories.map((c) => [
            c.name,
            c.active ? "Yes" : "No",
            <form action={A.toggleCategoryAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="id" value={c.id} />
              <input name="rename" placeholder="Rename" className="input w-32 py-1 text-xs" />
              <label className="text-xs"><input type="checkbox" name="active" defaultChecked={c.active} /> On</label>
              <button className="text-xs font-bold text-navy">Save</button>
            </form>,
          ])}
        />
      </Card>
      <Card title="Lock a month" note="After a month is closed with your accountant, lock it: nothing dated in that month can be added. Corrections are dated in an open month.">
        <form action={A.lockMonthAction} className="mb-4 flex flex-wrap items-end gap-3">
          <Field label="Month"><input type="month" name="month" className="input" required /></Field>
          <Save label="Lock month" />
        </form>
        {locks.length === 0 ? (
          <p className="text-sm">No months locked yet.</p>
        ) : (
          <Table
            head={["Month", "Status", ""]}
            empty=""
            minWidth={520}
            rows={locks.map((l) => [
              l.month,
              l.status === "locked" ? "Locked" : `Reopened ${l.reopenedAt ? l.reopenedAt.toISOString().slice(0, 10) : ""}: ${l.reopenReason ?? ""}`,
              l.status === "locked" ? (
                <form key="o" action={G.reopenMonthAction} className="flex gap-1"><input type="hidden" name="month" value={l.month} /><input name="reason" placeholder="Why (Owner only)" className="input w-40 py-1 text-xs" /><button className="text-xs font-bold text-[#C83A2F]">Reopen</button></form>
              ) : (
                <form key="l" action={G.reopenMonthAction}><input type="hidden" name="month" value={l.month} /><input type="hidden" name="relock" value="1" /><button className="text-xs font-bold text-navy">Lock again</button></form>
              ),
            ])}
          />
        )}
      </Card>
    </>
  );
}
