import ConfirmSubmit from "@/components/ConfirmSubmit";
import Link from "next/link";
import DualDate from "@/components/DualDate";
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
import { Card, CategorySelect, Field, FileInput, Grid, MethodSelect, Save, Stat, Steps, Table, money } from "./ui";

export const metadata = { title: "Bookkeeping | Hup Up Attractions" };
import { BOOK_TABS, bookTabLabel } from "@/lib/bookkeeping-tabs";
import { orderNumber } from "@/lib/orders";
import { orderPath } from "@/lib/order-path";

export const dynamic = "force-dynamic";

const TABS = BOOK_TABS;

type SP = { asOf?: string; account?: string; tab?: string; from?: string; to?: string; group?: string; msg?: string; err?: string; year?: string };

const methodName = (m: string) => (m === "zelle" ? "Zelle" : m === "sola_phonepay" ? "Sola (phone)" : m[0].toUpperCase() + m.slice(1));
const accountName = (a: string) => (a === "bank" ? "Bank account" : a === "card" ? "Credit card" : a);
const agingName = (b: string) => (b === "current" ? "Not due yet" : `${b} days late`);

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
    <div className="w-full" data-bookkeeping>
      <h1 className="mb-1 text-2xl font-black sm:text-3xl" data-book-title>{bookTabLabel(tab)}</h1>
      <p className="mb-4 text-muted">Owner only. Nothing here is ever deleted: a mistake is fixed with a correction entry (the Fix a mistake column), and closed months can be locked. Every amount is in dollars; type it like 125.50, without the $ sign.</p>
      {/* On big screens the side menu lists every Bookkeeping page; this row shows only on phones */}
      <nav className="mb-5 flex flex-wrap gap-2 lg:hidden" aria-label="Bookkeeping sections">
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
      {tab === "stripe" && <StripeFees from={from} to={to} />}
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
    <p className="mb-1 text-sm font-semibold text-muted">Pick a period, or choose your own dates below and press Show these dates.</p>
    <div className="mb-2 flex flex-wrap gap-2" data-date-presets>
      {datePresets(todayISO()).map((p) => (
        <Link key={p.key} href={`/admin/bookkeeping?tab=${tab}&from=${p.from}&to=${p.to}${group ? `&group=${group}` : ""}`} className={`rounded-full px-3 py-1 text-sm font-semibold ring-1 ring-line ${p.from === from && p.to === to ? "bg-navy text-white" : "bg-white text-navy hover:bg-bg"}`}>
          {p.label}
        </Link>
      ))}
    </div>
    <form className="mb-4 flex flex-wrap items-end gap-3" method="get">
      <input type="hidden" name="tab" value={tab} />
      <Field label="From (first day)"><input type="date" name="from" defaultValue={from} className="input" /></Field>
      <Field label="To (last day)"><input type="date" name="to" defaultValue={to} className="input" /></Field>
      {extra}
      <button className="btn-dark">Show these dates</button>
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
      <Steps steps={["Check the numbers for this year at a glance.", "Look at Reminders: anything red is overdue and should be paid or followed up today.", "Use the side menu to record money in (Income, Invoices) or money out (Expenses, Bills I owe).", "At the end of each month, upload the bank statement under Bank & card so everything matches."]} />
      <Card title={`${year} so far`} note="From January 1 until today. Income is shown before sales tax.">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
          <Stat label="Income" value={money(p?.totalIncome ?? 0)} note="before sales tax" />
          <Stat label="Expenses" value={money(p?.totalExpenses ?? 0)} />
          <Stat label="Net profit" value={money(p?.net ?? 0)} />
          <Stat label="This month's profit" value={money(month?.net ?? 0)} />
          <Stat label="Customers owe" value={money(ar)} note="open invoices" />
          <Stat label="We owe" value={money(ap)} note="open bills to pay" />
        </div>
      </Card>
      <Card title="Reminders" note={`Bills, sales tax and estimated tax due in the next ${days} days, overdue items, and recurring expenses. Shown here and on this page only (no texts or emails are sent).`}>
        <Table
          head={["Due date", "What it is", "Amount", "Status"]}
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
        <Field label="Type" hint="What kind of money this is.">
          <select name="kind" className="input" defaultValue={kinds[0]}>
            {kinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </Field>
        <Field label="Date" hint="The day the money was paid or received."><input type="date" name="date" defaultValue={todayISO()} className="input" required /></Field>
        <Field label="Amount ($)" hint="The full amount, for example 125.50."><input name="amount" inputMode="decimal" placeholder="0.00" className="input" required /></Field>
        <Field label="Payment method" hint="Cash, check, Zelle, card and so on."><MethodSelect /></Field>
        <Field label="Check number" hint="Only for a check. Leave empty otherwise."><input name="checkNo" className="input" /></Field>
        <Field label={tab === "income" ? "From (customer, school)" : "Vendor"} hint={tab === "income" ? "Who paid: the customer, school or company name." : "Who was paid: the store or company name."}><input name="party" className="input" /></Field>
        <Field label="Category" hint="Groups the money for reports and taxes."><CategorySelect categories={cats} /></Field>
        <Field label="Booking number (if any)" hint="The booking number from the order, for example 1234. Leave empty if none."><input name="orderId" inputMode="numeric" className="input" /></Field>
        {children}
        <Field label="Notes" wide hint="Anything that helps later. Never type a card number."><input name="notes" className="input" placeholder="Never type a card number" /></Field>
        <Field label="Receipt (photo or PDF, optional)" wide hint="Take a picture of the receipt or attach the PDF."><FileInput /></Field>
      </Grid>
      <Save label="Save entry" />
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
      head={["Entry number", "Date", "Type and category", "Paid by or paid to", "How paid", "Amount", "Breakdown", "Booking", "Receipt", "Fix a mistake"]}
      empty="No entries yet."
      minWidth={980}
      rows={entries.map((e) => [
        e.id,
        e.entryDate,
        <>{KIND_LABEL[e.kind as EntryKind] ?? e.kind}{e.category ? <span className="text-muted"> · {e.category}</span> : null}{e.source === "auto" ? <span className="ml-1 rounded bg-bg px-1 text-xs" title="Recorded automatically from a paid booking">automatic</span> : null}</>,
        e.party || e.personName || "—",
        <>{e.method ? methodName(e.method) : "—"}{e.checkNo ? `, check number ${e.checkNo}` : ""}</>,
        <b>{money(e.amountCents)}</b>,
        e.rentalCents || e.deliveryCents || e.taxCents || e.tipCents ? <span className="text-xs text-muted">rental {money(e.rentalCents)} · delivery {money(e.deliveryCents)} · tax {money(e.taxCents)} · tip {money(e.tipCents)}</span> : "",
        e.orderId ? <Link className="text-navy underline" href={orderPath(e.orderId)}>Booking number {1000 + Number(e.orderId)}</Link> : "—",
        e.fileId ? <a className="text-navy underline" href={`/admin/bookkeeping/files/${e.fileId}`} target="_blank">View</a> : "—",
        e.correctsId ? <span className="text-xs text-muted">This fixes entry number {e.correctsId}</span> : (
          <form action={A.reverseEntryAction} className="flex gap-1">
            <input type="hidden" name="id" value={e.id} />
            <input type="hidden" name="tab" value={tab} />
            <input name="reason" placeholder="Reason for the fix" aria-label="Reason for the fix" className="input w-36 py-1 text-xs" />
            <ConfirmSubmit message="Add a correction for this entry? The original entry is kept." className="text-xs font-bold text-[#C83A2F]">Fix</ConfirmSubmit>
          </form>
        ),
      ])}
    />
  );
}

async function Income({ cats }: { cats: string[] }) {
  return (
    <>
      <Steps steps={["Paid bookings from the phone line and New booking are saved here by themselves. Do not enter them again.", "For cash, a check, Zelle or another payment, fill in Record a payment and press Save entry.", "If the amount includes sales tax, delivery or a tip, type those parts too, so the reports split it correctly.", "Made a mistake? Find the entry in the list below, type the reason and press Fix."]} />
      <Card title="Record a payment" note="Paid bookings (phone line and staff New booking) are recorded automatically and split into rental, delivery, sales tax and tip. Use this for cash, checks, Zelle and other payments, deposits, refunds and cancellation fees.">
        <EntryForm tab="income" kinds={["income", "deposit", "refund", "cancellation_fee"]} cats={["Bookings", "Invoices", ...cats]}>
          <Field label="Sales tax included ($)" hint="The part of the amount that is sales tax."><input name="tax" inputMode="decimal" className="input" placeholder="0.00" /></Field>
          <Field label="Delivery fee included ($)" hint="The part of the amount that is the delivery fee."><input name="delivery" inputMode="decimal" className="input" placeholder="0.00" /></Field>
          <Field label="Tip ($)" hint="Any tip included in the amount."><input name="tip" inputMode="decimal" className="input" placeholder="0.00" /></Field>
          <Field label="Tax exempt sale" hint="Check this for a school or organization with a tax exempt certificate."><input type="checkbox" name="taxExempt" className="h-5 w-5" /></Field>
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
      <Steps steps={["Fastest way: type the booking number under Make one from a booking and press Make draft.", "Or fill in New invoice, quote or credit note by hand: customer, items, prices, then Save.", "Open the invoice number in the list to check it, print it or save it as a PDF and send it.", "When the customer pays, type the date, amount and how they paid in the Record a payment column and press Save."]} />
      <Card title="Make one from a booking" note="Copies the booking's items, delivery fee and sales tax exactly as charged. Saved as a draft for you to check.">
        <form action={I.fromBookingAction} className="flex flex-wrap items-end gap-3">
          <Field label="Booking number" hint="For example 1234."><input name="orderId" inputMode="numeric" className="input w-28" required /></Field>
          <Field label="Type" hint="Invoice = asks for payment. Quote = price offer only."><select name="kind" className="input"><option value="invoice">Invoice</option><option value="quote">Quote</option></select></Field>
          <Field label="Payment terms (days)" hint="Days the customer has to pay. 0 = due now."><input name="termsDays" type="number" min={0} defaultValue={0} className="input w-24" /></Field>
          <Save label="Make draft" />
        </form>
      </Card>
      <Card title="New invoice, quote or credit note" note="Schools and institutions that pay by check: set payment terms. Tax-exempt customers: enter the certificate number (attach the certificate on the old form below if needed).">
        <form action={I.createDocAction} className="space-y-3">
          <Grid>
            <Field label="Type" hint="A credit note gives money back on an invoice."><select name="kind" className="input"><option value="invoice">Invoice</option><option value="quote">Quote</option><option value="credit_note">Credit note</option></select></Field>
            <Field label="Customer or school" hint="Start typing to pick an existing customer."><input name="customerName" list="book-customers" className="input" required /><datalist id="book-customers">{customers.map((c) => <option key={c} value={c} />)}</datalist></Field>
            <Field label="Email"><input name="customerEmail" type="email" className="input" /></Field>
            <Field label="Phone"><input name="customerPhone" type="tel" inputMode="tel" className="input" placeholder="845-415-7585" /></Field>
            <Field label="Billing address" wide><input name="billingAddress" className="input" /></Field>
            <Field label="Date"><input type="date" name="issueDate" defaultValue={today} className="input" /></Field>
            <Field label="Payment terms (days)"><input name="termsDays" type="number" min={0} defaultValue={0} className="input" /></Field>
            <Field label="Booking number (optional)"><input name="orderId" inputMode="numeric" className="input" /></Field>
            <Field label="Credit note for invoice" hint="Only for a credit note: the invoice it belongs to.">
              <select name="relatedInvoiceId" className="input" defaultValue="">
                <option value="">Not a credit note</option>
                {invoices.filter((i) => i.status === "open").map((i) => <option key={i.id} value={i.id}>{i.number ?? `Number ${i.id}`} · {i.customerName}</option>)}
              </select>
            </Field>
          </Grid>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr><th className="th">Item or service (one per line)</th><th className="th">Quantity</th><th className="th">Price each ($)</th></tr></thead>
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
            <Field label="Discount ($)" hint="Leave empty for no discount."><input name="discount" inputMode="decimal" className="input" /></Field>
            <Field label="Sales tax ($, as charged)" hint="The sales tax amount on this invoice."><input name="tax" inputMode="decimal" className="input" /></Field>
            <Field label="Deposit required ($)" hint="Amount to pay before the event, if any."><input name="deposit" inputMode="decimal" className="input" /></Field>
            <Field label="Tax exempt" hint="Check for a school or organization that does not pay sales tax."><input type="checkbox" name="taxExempt" className="h-5 w-5" /></Field>
            <Field label="Exempt certificate number" hint="From the customer's tax exempt certificate."><input name="exemptCertNo" className="input" /></Field>
            <Field label="Notes on the document" wide hint="The customer sees these notes on the invoice."><input name="notes" className="input" /></Field>
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
          head={["Number (open it)", "Type", "Customer (statement)", "Date", "Due date", "Total", "Still owed", "Status", "Record a payment"]}
          empty="Nothing yet."
          minWidth={1150}
          rows={docs.map((d) => [
            <a key="n" className="font-bold text-navy underline" href={`/admin/bookkeeping/invoice/${d.id}`}>{d.number ?? `Number ${d.id}`}</a>,
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
                <input name="amount" placeholder="Amount $" aria-label="Amount paid" className="input w-24 py-1 text-xs" />
                <select name="method" aria-label="How paid" className="input w-24 py-1 text-xs" defaultValue="check"><option value="check">Check</option><option value="zelle">Zelle</option><option value="cash">Cash</option><option value="bank">Bank</option><option value="other">Other</option></select>
                <input name="checkNo" placeholder="Check number" aria-label="Check number" className="input w-28 py-1 text-xs" />
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
      <Steps steps={["For anything the business paid for, fill in Record an expense and press Save entry.", "Attach a photo of the receipt so the accountant can see it.", "Repairs on a rental item: choose the item, so it shows against that item's profit.", "For things paid every month (phone, insurance, software), add them once under Recurring expenses; on each date press Paid now or Add as a bill."]} />
      <Card title="Record an expense" note="Repairs on a rental item: choose the item so it counts against that item's profit.">
        <EntryForm tab="expenses" kinds={["expense"]} cats={cats}>
          <Field label="Project (Tasks)" hint="Optional: link the cost to a project in Tasks.">
            <select name="projectId" className="input" defaultValue="">
              <option value="">No project</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Rental item (repairs)" hint="Only for a repair or part for one rental item.">
            <select name="productId" className="input" defaultValue="">
              <option value="">Not for one item</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
        </EntryForm>
      </Card>
      <Card title="Recurring expenses and subscriptions" note="On each date, press Paid now (records the expense) or Add as a bill (not paid yet, goes to Bills I owe). The date then moves to the next one. Stop ends it.">
        <form action={A.addRecurringAction} className="mb-4 space-y-3">
          <Grid>
            <Field label="Vendor or subscription" hint="For example: phone company, insurance."><input name="vendor" className="input" required /></Field>
            <Field label="Amount ($)" hint="The usual amount each time."><input name="amount" inputMode="decimal" className="input" required /></Field>
            <Field label="How often">
              <select name="frequency" className="input" defaultValue="monthly"><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option></select>
            </Field>
            <Field label="Next date" hint="The next day it is due."><input type="date" name="nextDate" className="input" required /></Field>
            <Field label="Category"><CategorySelect categories={cats} /></Field>
            <Field label="Payment method"><MethodSelect /></Field>
          </Grid>
          <Save label="Add recurring expense" />
        </form>
        <Table
          head={["Vendor", "Amount", "How often", "Next date", "Category", "Record this time", "Stop it"]}
          empty="No recurring expenses yet."
          rows={rec.map((r) => [
            r.vendor,
            money(r.amountCents),
            r.frequency[0].toUpperCase() + r.frequency.slice(1),
            r.nextDate,
            r.category ?? "—",
            r.active ? (
              <div className="flex gap-2">
                <form action={A.recordRecurringAction}><input type="hidden" name="id" value={r.id} /><button className="text-xs font-bold text-navy">Paid now</button></form>
                <form action={A.recordRecurringAction}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="as" value="bill" /><button className="text-xs font-bold text-navy">Add as a bill</button></form>
              </div>
            ) : <span className="text-muted">Stopped</span>,
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
      <Steps steps={["When a bill arrives that is not paid yet, fill in New bill with the due date and press Save bill.", "Bills due soon show on the Overview page under Reminders.", "When you pay it, type the date and amount in the Pay column and press Pay. A part payment is fine; the rest stays owed.", "Entered by mistake? Type the reason and press Void. It stays on record as voided."]} />
      <Card title="New bill" note="A bill is money the business owes and has not paid yet.">
        <form action={A.addBillAction} className="space-y-3">
          <Grid>
            <Field label="Vendor" hint="Who sent the bill."><input name="vendor" className="input" required /></Field>
            <Field label="Amount ($)" hint="The total on the bill."><input name="amount" inputMode="decimal" className="input" required /></Field>
            <Field label="Bill date" hint="The date printed on the bill."><input type="date" name="billDate" defaultValue={today} className="input" /></Field>
            <Field label="Due date" hint="The last day to pay it."><input type="date" name="dueDate" className="input" required /></Field>
            <Field label="Category"><CategorySelect categories={cats} /></Field>
            <Field label="Bill (PDF or photo)" hint="Attach a copy of the bill."><FileInput /></Field>
            <Field label="Notes" wide><input name="notes" className="input" /></Field>
          </Grid>
          <Save label="Save bill" />
        </form>
      </Card>
      <Card title="Payables aging" note="What the business owes on open bills, by how late it is.">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          {buckets.map((b) => <Stat key={b} label={b === "current" ? "Not due yet" : `${b} days late`} value={money(aging.filter((x) => x.bucket === b).reduce((s, x) => s + x.balanceCents, 0))} />)}
        </div>
      </Card>
      <Card title="Bills">
        <Table
          head={["Bill number", "Vendor", "Due date", "Amount", "Paid so far", "Still owed", "Pay it", "Void (entered by mistake)"]}
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
                  <input name="amount" placeholder="Amount $" aria-label="Amount paid" className="input w-24 py-1 text-xs" />
                  <MethodSelect />
                  <button className="text-xs font-bold text-navy">Pay</button>
                </form>
              ) : "—",
              b.status === "open" ? (
                <form action={A.voidBillAction} className="flex gap-1"><input type="hidden" name="id" value={b.id} /><input name="reason" placeholder="Reason" aria-label="Reason to void" className="input w-28 py-1 text-xs" /><ConfirmSubmit message="Void this bill? It stays on record as voided." className="text-xs font-bold text-[#C83A2F]">Void</ConfirmSubmit></form>
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
      <Steps steps={["Pick the dates to check.", "Card payments made through Sola are listed with the estimated fee and the amount expected at the bank.", "When the Sola monthly statement comes, add the real fee as an expense with the type Processor fee.", "Compare Expected deposits with the bank statement."]} />
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
          head={["Date", "Booking", "Sola reference", "Payment", "Estimated fee", "Expected at the bank"]}
          empty="No Sola payments in this range."
          rows={v.rows.map((r) => [r.date, r.orderId ? <Link className="text-navy underline" href={orderPath(r.orderId)}>Booking number {1000 + Number(r.orderId)}</Link> : "—", r.ref ?? "—", money(r.grossCents), money(r.feeCents), <b>{money(r.netCents)}</b>])}
        />
      </Card>
    </>
  );
}

/** Stripe fees and payouts (phone payments), pulled with the read-only Stripe key; each fee is in the books. */
async function StripeFees({ from, to }: { from: string; to: string }) {
  const { stripeBooks } = await import("@/lib/stripe-ops");
  const { lines, payouts } = await stripeBooks(from, to);
  const pay = lines.filter((l) => l.type === "charge" || l.type === "payment");
  const fees = lines.reduce((n, l) => n + l.feeCents, 0);
  const when = (d: Date | null) => (d ? d.toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric" }) : "—");
  return (
    <>
      <Steps steps={["Pick the dates to check.", "Press Update from Stripe to bring in the newest payments, fees and payouts.", "Each Stripe fee is added to the books by itself.", "Match each payout with the deposit on the bank statement."]} />
      <RangeForm tab="stripe" from={from} to={to} />
      {!process.env.STRIPE_READ_KEY && (
        <p className="card mb-4 border-l-4 border-sun p-4 text-sm">
          <b>Not active yet:</b> Stripe fees come in with a read-only Stripe key (STRIPE_READ_KEY in Vercel).
        </p>
      )}
      <Card title="Stripe payments, fees and payouts" note="Phone payments by keypad go through Stripe. Each Stripe fee is entered in the books as a Stripe fees processor fee; each payout is the deposit you see at the bank.">
        <form action={A.syncStripeAction} className="mb-4">
          <button className="btn-dark !py-1.5 text-sm" disabled={!process.env.STRIPE_READ_KEY}>Update from Stripe</button>
        </form>
        <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Card payments" value={money(pay.reduce((n, l) => n + l.amountCents, 0))} />
          <Stat label="Stripe fees" value={money(fees)} />
          <Stat label="Net" value={money(pay.reduce((n, l) => n + l.netCents, 0))} />
          <Stat label="Paid out to the bank" value={money(payouts.filter((p) => p.status === "paid").reduce((n, p) => n + p.amountCents, 0))} />
        </div>
        <Table
          head={["Date", "Type", "Booking", "Amount", "Stripe fee", "Amount after the fee"]}
          empty="No Stripe lines in this range."
          rows={lines.map((l) => [when(l.happenedAt), l.type.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), l.orderId ? <Link className="text-navy underline" href={orderPath(l.orderId)}>Order number {orderNumber(l.orderId)}</Link> : "—", money(l.amountCents), money(l.feeCents), <b>{money(l.netCents)}</b>])}
        />
      </Card>
      <Card title="Payouts to the bank" note="Match each payout to the deposit on the bank statement.">
        <Table head={["Sent by Stripe", "Arrives at the bank", "Amount", "Status"]} empty="No payouts in this range." rows={payouts.map((p) => [when(p.createdAt), when(p.arrivalDate), money(p.amountCents), p.status])} />
      </Card>
    </>
  );
}

async function Bank({ cats }: { cats: string[] }) {
  const lines = await db.select().from(schema.bookBankLines).orderBy(desc(schema.bookBankLines.lineDate), desc(schema.bookBankLines.id)).limit(300);
  const unmatched = lines.filter((l) => l.status === "unmatched");
  return (
    <>
      <Steps steps={["Download the statement as a CSV file from the bank or credit card website.", "Choose Bank account or Credit card, choose the file and press Upload and match.", "Most lines match by themselves. For each line under Not matched: type the entry number and press Match, choose a category and press Add to books, or press Ignore for a move between your own accounts.", "When Not matched is empty, the books match the bank."]} />
      <Card title="Upload a statement" note="Download the CSV from your bank or card website and upload it here. Each line is matched to the books automatically (same amount within 5 days, or a Sola batch deposit). Lines already uploaded are skipped.">
        <form action={A.importStatementAction} className="flex flex-wrap items-end gap-3">
          <Field label="Account" hint="Which statement this is.">
            <select name="account" className="input"><option value="bank">Bank account</option><option value="card">Credit card</option></select>
          </Field>
          <Field label="CSV file" hint="The file downloaded from the bank."><input type="file" name="file" accept=".csv,text/csv" className="input py-2 text-sm" required /></Field>
          <Save label="Upload and match" />
        </form>
        <form action={A.autoMatchAction} className="mt-3"><button className="text-sm font-bold text-navy underline">Try matching again</button></form>
      </Card>
      <Card title={`Not matched (${unmatched.length})`} note="Match by hand with the entry number(s) from All entries, add the missing income or expense first, or mark a line as ignored (for example a transfer between your own accounts).">
        <Table
          head={["Date", "Account", "Description from the bank", "Amount", "What to do"]}
          empty="Everything is matched."
          minWidth={900}
          rows={unmatched.map((l) => [
            l.lineDate,
            accountName(l.account),
            l.description,
            <b className={l.amountCents < 0 ? "text-[#C83A2F]" : ""}>{money(l.amountCents)}</b>,
            <div className="flex flex-wrap gap-2">
              <form action={A.matchLineAction} className="flex gap-1"><input type="hidden" name="id" value={l.id} /><input name="entryIds" placeholder="Entry number" aria-label="Entry number(s), separated by commas" className="input w-28 py-1 text-xs" /><button className="text-xs font-bold text-navy">Match</button></form>
              <form action={A.matchLineAction}><input type="hidden" name="id" value={l.id} /><input type="hidden" name="ignore" value="1" /><button className="text-xs font-bold text-muted">Ignore</button></form>
              <form action={A.categorizeLineAction} className="flex gap-1">
                <input type="hidden" name="id" value={l.id} />
                <select name="category" className="input w-36 py-1 text-xs" defaultValue="" aria-label="Category">
                  <option value="">Choose a category</option>
                  {(l.amountCents < 0 ? cats : ["Bookings", "Invoices", "Other income"]).map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <button className="text-xs font-bold text-navy">Add to books</button>
              </form>
            </div>,
          ])}
        />
      </Card>
      <Card title="Matched and ignored">
        <Table head={["Date", "Account", "Description from the bank", "Amount", "Matched to"]} empty="None yet." minWidth={800} rows={lines.filter((l) => l.status !== "unmatched").map((l) => [l.lineDate, accountName(l.account), l.description, money(l.amountCents), <span className="text-xs">{l.status === "ignored" ? `Ignored: ${l.matchNote ?? ""}` : l.matchNote}</span>])} />
      </Card>
    </>
  );
}

async function Tax({ year }: { year: number }) {
  const periods = salesTaxPeriods(year);
  const sums = await Promise.all(periods.map((p) => salesTaxSummary(p.from, p.to)));
  return (
    <>
      <Steps steps={["Choose the year and press Show.", "Each quarter shows taxable sales, tax exempt sales and the sales tax collected, by county.", "Before the due date, open Printable filing summary and use those numbers to file on NY Business Online Services.", "Tax exempt sales need the customer's certificate on file."]} />
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
      <Steps steps={["When you buy a rental item or other equipment (trailer, blower), add it under Add equipment.", "Choose the rental item from the list, or type a name for other equipment.", "Repairs are not entered here: enter them as an expense and choose the item.", "Profit per item and the Depreciation list update by themselves; give the list to the accountant."]} />
      <Card title="Add equipment" note="Each rental item's purchase cost and date. Repairs are expenses with the item chosen.">
        <form action={A.addEquipmentAction} className="space-y-3">
          <Grid>
            <Field label="Rental item">
              <select name="productId" className="input" defaultValue="">
                <option value="">Other equipment (type the name)</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Name (other equipment)" hint="Only when it is not a rental item."><input name="name" className="input" placeholder="e.g. Delivery trailer" /></Field>
            <Field label="Purchase date"><input type="date" name="purchaseDate" className="input" required /></Field>
            <Field label="Cost per unit ($)" hint="The price of one, before tax."><input name="cost" inputMode="decimal" className="input" required /></Field>
            <Field label="Quantity"><input name="qty" type="number" min={1} defaultValue={1} className="input" /></Field>
            <Field label="Years to depreciate" hint="Ask the accountant; 5 is common."><input name="lifeYears" type="number" min={1} defaultValue={5} className="input" /></Field>
            <Field label="Notes" wide><input name="notes" className="input" /></Field>
          </Grid>
          <Save />
        </form>
      </Card>
      <Card title="Profit per item (all time)">
        <Table head={["Item", "Times rented", "Income", "Repairs", "Purchase cost", "Profit"]} empty="No rentals yet." rows={profit.map((r) => [r.name, r.rentals, money(r.incomeCents), money(r.repairsCents), money(r.costCents), <b>{money(r.profitCents)}</b>])} />
      </Card>
      <Card title={`Depreciation list ${year} (for the accountant)`} note="Straight-line, by month of purchase. Your accountant chooses the actual tax method.">
        <Table head={["Item", "Purchased", "Quantity", "Cost", "Years", `Depreciation ${year}`, "Depreciation so far", "Value now"]} empty="No equipment entered yet." rows={dep.map((q) => [q.name, q.purchaseDate, q.qty, money(q.totalCostCents), q.lifeYears, money(q.thisYearCents), money(q.accumulatedCents), money(q.bookValueCents)])} />
      </Card>
    </>
  );
}

async function People({ year }: { year: number }) {
  const people = await people1099(year);
  const staff = await db.select({ name: schema.adminUsers.name }).from(schema.adminUsers).where(eq(schema.adminUsers.active, true));
  return (
    <>
      <Steps steps={["Each time you pay a worker, fill in Pay a staff member or contractor and press Save entry.", "Use the same spelling of the name every time, so the yearly total is right.", "At the end of the year, the list shows who needs a 1099 form.", "Give that list to the accountant."]} />
      <Card title="Pay a staff member or contractor">
        <form action={A.addEntryAction} className="space-y-3">
          <input type="hidden" name="tab" value="people" />
          <input type="hidden" name="kind" value="contractor" />
          <Grid>
            <Field label="Person" hint="Start typing to pick a staff member.">
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
        <Table head={["Person", "Number of payments", "Total paid", "1099 form needed?"]} empty="No payments this year." rows={people.map((p) => [p.name, p.payments, money(p.cents), p.needs1099 ? <b>Yes</b> : "No"])} />
      </Card>
    </>
  );
}

async function Mileage({ from, to }: { from: string; to: string }) {
  const m = await mileageSummary(from, to);
  return (
    <>
      <Steps steps={["After each delivery or business drive, fill in Log a trip and press Save entry.", "Miles can have a decimal, for example 12.5.", "Pick dates below to see the total miles per vehicle.", "Wrong trip? Type the reason and press Fix."]} />
      <Card title="Log a trip">
        <form action={A.addMileageAction} className="space-y-3">
          <Grid>
            <Field label="Date"><input type="date" name="tripDate" defaultValue={todayISO()} className="input" /></Field>
            <Field label="Miles" hint="Round trip, for example 12.5."><input name="miles" inputMode="decimal" className="input" required /></Field>
            <Field label="Vehicle" hint="Use the same name each time, for example Van 1."><input name="vehicle" className="input" /></Field>
            <Field label="Driver"><input name="driver" className="input" /></Field>
            <Field label="Purpose" hint="Delivery, pickup, buying supplies."><input name="purpose" defaultValue="Delivery" className="input" /></Field>
            <Field label="Booking number" hint="Optional, for example 1234."><input name="orderId" inputMode="numeric" className="input" /></Field>
            <Field label="Notes" wide><input name="notes" className="input" /></Field>
          </Grid>
          <Save />
        </form>
      </Card>
      <RangeForm tab="mileage" from={from} to={to} />
      <Card title={`Trips: ${(m.totalTenths / 10).toLocaleString()} miles`} note={m.byVehicle.map((v) => `${v.vehicle}: ${(v.tenths / 10).toLocaleString()} mi`).join(" · ") || undefined}>
        <Table
          head={["Date", "Vehicle", "Driver", "Miles", "Purpose", "Booking", "Fix a mistake"]}
          empty="No trips in this range."
          rows={m.trips.map((t) => [
            t.tripDate,
            t.vehicle ?? "—",
            t.driver ?? "—",
            (t.milesTenths / 10).toFixed(1),
            <>{t.purpose}{t.notes ? <span className="text-muted"> · {t.notes}</span> : null}</>,
            t.orderId ? <Link className="text-navy underline" href={orderPath(t.orderId)}>Booking number {orderNumber(t.orderId)}</Link> : "—",
            t.correctsId ? "" : <form action={A.reverseMileageAction} className="flex gap-1"><input type="hidden" name="id" value={t.id} /><input name="reason" placeholder="Reason for the fix" aria-label="Reason for the fix" className="input w-36 py-1 text-xs" /><button className="text-xs font-bold text-[#C83A2F]">Fix</button></form>,
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
      <Steps steps={["Pick the period, choose Group by (month, quarter or year) and press Show these dates.", "Read Profit and loss: income, each expense, and net profit for each period.", "Under Download, get any report in Excel or CSV, or press Print to save it as a PDF.", "For the accountant: QuickBooks Online CSV or QuickBooks Desktop IIF has every entry."]} />
      <RangeForm
        tab="reports"
        from={from}
        to={to}
        group={group}
        extra={
          <Field label="Group by" hint="How to split the rows.">
            <select name="group" defaultValue={group} className="input"><option value="month">Month</option><option value="quarter">Quarter</option><option value="year">Year</option></select>
          </Field>
        }
      />
      <Card title="Download" note="Excel and CSV for every report; QuickBooks Online (bank-transactions CSV) and QuickBooks Desktop (IIF) for all entries; printable pages to save as PDF.">
        <Table
          head={["Report", "Excel", "CSV (spreadsheet)", "Print or save as PDF"]}
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
          head={["Period", "Income", ...cats, "Card processing fees", "Staff and contractors", "Total expenses", "Net profit", "Sales tax collected"]}
          empty="No entries in this range."
          minWidth={800}
          rows={rows.map((r) => [r.period, money(r.totalIncome), ...cats.map((c) => money(r.expenses[c] ?? 0)), money(r.processorFees), money(r.contractors), money(r.totalExpenses), <b>{money(r.net)}</b>, money(r.taxCollected)])}
        />
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Cash flow"><Table head={["Month", "Money in", "Money out", "Difference", "Running total"]} empty="—" minWidth={420} rows={flow.map((r) => [r.month, money(r.moneyIn), money(r.moneyOut), money(r.net), money(r.running)])} /></Card>
        <Card title="Expenses by category"><Table head={["Category", "Amount"]} empty="—" minWidth={300} rows={byCat.map((r) => [r.category, money(r.cents)])} /></Card>
        <Card title="Income by channel" note="The website has no online booking; payments for phone bookings made on the website's pay page count under Phone line.">
          <Table head={["Channel", "Income"]} empty="—" minWidth={300} rows={byCh.map((r) => [r.channel, money(r.cents)])} />
        </Card>
        <Card title="Receivables aging" note="Open invoices customers still owe."><Table head={["Invoice", "Customer", "Still owed", "How late"]} empty="Nothing owed." minWidth={400} rows={ar.map((i) => [<a key="i" className="text-navy underline" href={`/admin/bookkeeping/invoice/${i.id}`}>Invoice {i.id}</a>, i.customerName, money(i.balanceCents), agingName(i.bucket)])} /></Card>
      </div>
      <Card title="Income by item" note="Income minus repairs for each rental item in this period."><Table head={["Item", "Times rented", "Income", "Repairs", "Profit"]} empty="—" rows={byItem.map((r) => [r.name, r.rentals, money(r.incomeCents), money(r.repairsCents), money(r.profitCents)])} /></Card>
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
      <Steps steps={["Pick the dates and press Show these dates.", "Every money movement in that period is listed, newest first.", "Open a receipt with View, or a booking with its booking number.", "To fix a mistake, type the reason and press Fix: an opposite entry is added and both stay on record."]} />
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
      <Steps steps={["Set the Sola card rate once, from the Sola agreement.", "Set the opening cash balance: the bank balance on the day you started using these books.", "Add or rename expense categories as needed. Turning one off hides it from new entries.", "After the accountant closes a month, lock it so nothing changes in it."]} />
      <Card title="Sola rate and reminders">
        <form action={A.saveBookSettingsAction} className="space-y-3">
          <Grid>
            <Field label="Sola rate (%)" hint="For example 2.9."><input name="solaFeePercent" defaultValue={pct} className="input" /></Field>
            <Field label="Sola fee per payment ($)" hint="For example 0.30."><input name="solaFeeFixed" defaultValue={((Number(fixed) || 0) / 100).toFixed(2)} className="input" /></Field>
            <Field label="Remind me this many days before" hint="How early bills show under Reminders."><input name="bookReminderDays" type="number" defaultValue={days} className="input" /></Field>
            <Field label="Opening cash balance ($)" hint="The bank balance on the opening date."><input name="openingCash" defaultValue={((Number(openingCash) || 0) / 100).toFixed(2)} className="input" /></Field>
            <Field label="Opening balance date" hint="The day you started these books."><input type="date" name="openingDate" defaultValue={openingDate} className="input" /></Field>
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
          head={["Category", "In use", "Rename or turn on and off"]}
          empty="—"
          minWidth={420}
          rows={categories.map((c) => [
            c.name,
            c.active ? "Yes" : "No",
            <form action={A.toggleCategoryAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="id" value={c.id} />
              <input name="rename" placeholder="New name" aria-label="New name" className="input w-40 py-1 text-xs" />
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
            head={["Month", "Status", "Change"]}
            empty=""
            minWidth={520}
            rows={locks.map((l) => [
              l.month,
              l.status === "locked" ? "Locked" : <span key="r">Reopened {l.reopenedAt ? <DualDate at={l.reopenedAt} /> : null}: {l.reopenReason ?? ""}</span>,
              l.status === "locked" ? (
                <form key="o" action={G.reopenMonthAction} className="flex gap-1"><input type="hidden" name="month" value={l.month} /><input name="reason" placeholder="Reason (Owner only)" aria-label="Reason to reopen" className="input w-44 py-1 text-xs" /><ConfirmSubmit message="Reopen this locked month? Entries dated in it can be added or changed again." className="text-xs font-bold text-[#C83A2F]">Reopen</ConfirmSubmit></form>
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
