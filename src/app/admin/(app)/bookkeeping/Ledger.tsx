import { asc, desc } from "drizzle-orm";
import { CircleAlert } from "lucide-react";
import { db, schema } from "@/lib/db";
import { todayISO } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { ACCOUNT_TYPES, ACCOUNT_TYPE_LABEL, accountDetail, glSetup, trialBalance } from "@/lib/gl";
import * as G from "./gl-actions";
import { Card, Field, Grid, Save, Table, money } from "./ui";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** General ledger tab (Bookkeeping spec step 1). */
export default async function Ledger({ asOf, accountId, from, to, owner }: { asOf: string; accountId?: number; from: string; to: string; owner: boolean }) {
  const st = await getSettings();
  const setup = await glSetup(st);
  const accounts = await db.select().from(schema.glAccounts).orderBy(asc(schema.glAccounts.code));
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const entries = await db.select().from(schema.journalEntries).orderBy(desc(schema.journalEntries.id)).limit(50);
  const lines = entries.length ? await db.select().from(schema.journalLines) : [];
  const tb = await trialBalance(asOf);
  const detail = accountId ? await accountDetail(accountId, from, to) : null;
  const active = accounts.filter((a) => a.active);
  return (
    <div data-gl>
      {!setup.ready && (
        <p data-not-active="gl" className="mb-4 flex items-start gap-2 rounded-xl border border-[#E8B400]/50 bg-[#FFF8E1] px-4 py-3 text-sm text-[#5C4600]">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#123D73]" aria-hidden />
          <span>
            <b>Not active yet: needs accountant setup.</b> Missing: {setup.missing.join("; ")}. Journal entries can be prepared as drafts; nothing posts until this is done.
          </span>
        </p>
      )}

      <Card title="Ledger setup" note={owner ? "Owner only. Enter these from the accountant; nothing is filled in for you." : "Set by the Owner from the accountant."}>
        <form action={G.saveGlSetupAction} className="space-y-3">
          <Grid>
            <Field label="Fiscal year starts">
              <select name="fiscalStart" defaultValue={st.glFiscalYearStartMonth} className="input" disabled={!owner}>
                <option value="">Not set</option>
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </Field>
            <Field label="Accounting method">
              <select name="method" defaultValue={st.glAccountingMethod} className="input" disabled={!owner}>
                <option value="">Not set</option>
                <option value="cash">Cash</option>
                <option value="accrual">Accrual</option>
              </select>
            </Field>
            <Field label="Base currency"><input value={st.glBaseCurrency} readOnly className="input" /></Field>
            <Field label="Second approver needed from ($)"><input name="threshold" defaultValue={st.glApprovalThresholdCents ? (Number(st.glApprovalThresholdCents) / 100).toFixed(2) : ""} placeholder="Not set" className="input" disabled={!owner} /></Field>
            <Field label="Chart approved by (accountant)"><input name="approvedBy" defaultValue={st.glChartApprovedBy} className="input" disabled={!owner} /></Field>
            <Field label="Approval">
              <span className="block pt-2 text-sm">
                {st.glChartApprovedBy ? <>Approved by {st.glChartApprovedBy} on {st.glChartApprovedOn}</> : "Not approved yet"}
              </span>
            </Field>
            {owner && (
              <Field label="Record approval" wide>
                <label className="mr-4 text-sm"><input type="checkbox" name="approve" /> The accountant approved this chart of accounts</label>
                {st.glChartApprovedBy && <label className="text-sm"><input type="checkbox" name="unapprove" /> Withdraw approval</label>}
              </Field>
            )}
          </Grid>
          {owner && <Save />}
        </form>
      </Card>

      <Card title="Chart of accounts" note="Codes, names and types from the accountant. Accounts are never deleted; turn one off instead.">
        <form action={G.saveAccountAction} className="mb-4 flex flex-wrap items-end gap-2">
          <Field label="Code"><input name="code" className="input w-28" required /></Field>
          <Field label="Name"><input name="name" className="input w-56" required /></Field>
          <Field label="Type">
            <select name="type" className="input" defaultValue="">
              <option value="" disabled>Choose</option>
              {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{ACCOUNT_TYPE_LABEL[t]}</option>)}
            </select>
          </Field>
          <Field label="Parent (optional)">
            <select name="parentId" className="input" defaultValue="">
              <option value="">None</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
            </select>
          </Field>
          <Save label="Add account" />
        </form>
        <Table
          head={["Code", "Name", "Type", "Parent", "Active", ""]}
          empty="No accounts yet. Enter the accountant's chart of accounts here."
          minWidth={760}
          rows={accounts.map((a) => [
            a.code,
            a.name,
            ACCOUNT_TYPE_LABEL[a.type as keyof typeof ACCOUNT_TYPE_LABEL] ?? a.type,
            a.parentId ? byId.get(a.parentId)?.code ?? "" : "—",
            a.active ? "Yes" : "No",
            <form key="f" action={G.saveAccountAction} className="flex flex-wrap gap-1">
              <input type="hidden" name="id" value={a.id} />
              <input name="code" defaultValue={a.code} className="input w-20 py-1 text-xs" aria-label="Code" />
              <input name="name" defaultValue={a.name} className="input w-36 py-1 text-xs" aria-label="Name" />
              <input type="hidden" name="type" value={a.type} />
              <input type="hidden" name="parentId" value={a.parentId ?? ""} />
              <select name="active" defaultValue={a.active ? "on" : "off"} className="input w-20 py-1 text-xs" aria-label="Active"><option value="on">On</option><option value="off">Off</option></select>
              <button className="text-xs font-bold text-navy">Save</button>
            </form>,
          ])}
        />
      </Card>

      <Card title="New journal entry" note="Debits must equal credits. Saved as a draft; it posts once approved (and only after the accountant setup).">
        <form action={G.createJournalAction} className="space-y-3">
          <Grid>
            <Field label="Date"><input type="date" name="date" defaultValue={todayISO()} className="input" required /></Field>
            <Field label="Memo (why)" wide><input name="memo" className="input" required /></Field>
          </Grid>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead><tr><th className="th">Account</th><th className="th">Debit ($)</th><th className="th">Credit ($)</th><th className="th">Line memo</th></tr></thead>
              <tbody>
                {Array.from({ length: 6 }, (_, i) => (
                  <tr key={i}>
                    <td className="td">
                      <select name={`acct${i}`} className="input py-1" defaultValue="">
                        <option value="">—</option>
                        {active.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
                      </select>
                    </td>
                    <td className="td"><input name={`dr${i}`} inputMode="decimal" className="input py-1" /></td>
                    <td className="td"><input name={`cr${i}`} inputMode="decimal" className="input py-1" /></td>
                    <td className="td"><input name={`memo${i}`} className="input py-1" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label className="block text-sm"><input type="checkbox" name="post" /> Post now (if I&rsquo;m allowed to approve it)</label>
          <Save label="Save entry" />
        </form>
      </Card>

      <Card title="Journal entries">
        <Table
          head={["#", "Date", "Memo", "Lines", "Amount", "Status", ""]}
          empty="No journal entries yet."
          minWidth={900}
          rows={entries.map((e) => [
            e.id,
            e.entryDate,
            e.memo,
            <span key="l" className="text-xs">
              {lines.filter((l) => l.entryId === e.id).map((l) => (
                <span key={l.id} className="block">{byId.get(l.accountId)?.code} {l.debitCents ? `Dr ${money(l.debitCents)}` : `Cr ${money(l.creditCents)}`}</span>
              ))}
            </span>,
            money(e.totalCents),
            <b key="s">{e.status === "pending" ? "Waiting for approval" : e.status[0].toUpperCase() + e.status.slice(1)}</b>,
            e.status === "draft" || e.status === "pending" ? (
              <form key="p" action={G.postJournalAction}><input type="hidden" name="id" value={e.id} /><button className="text-xs font-bold text-navy">Approve and post</button></form>
            ) : e.status === "posted" ? (
              <form key="r" action={G.reverseJournalAction} className="flex gap-1"><input type="hidden" name="id" value={e.id} /><input name="reason" placeholder="Why" className="input w-24 py-1 text-xs" /><button className="text-xs font-bold text-[#C83A2F]">Reverse</button></form>
            ) : "",
          ])}
        />
      </Card>

      <Card title={`Trial balance as of ${asOf}`} note={tb.debitCents === tb.creditCents ? "Debits equal credits." : "Out of balance: check the entries."}>
        <form method="get" className="mb-3 flex items-end gap-2"><input type="hidden" name="tab" value="gl" /><Field label="As of"><input type="date" name="asOf" defaultValue={asOf} className="input" /></Field><button className="btn-dark">Show</button></form>
        <Table
          head={["Code", "Account", "Debit", "Credit"]}
          empty="Nothing posted yet."
          minWidth={480}
          rows={[
            ...tb.lines.map((l) => [l.code, <a key="a" className="text-navy underline" href={`/admin/bookkeeping?tab=gl&account=${l.id}&from=${from}&to=${to}`}>{l.name}</a>, l.debitCents ? money(l.debitCents) : "", l.creditCents ? money(l.creditCents) : ""]),
            ...(tb.lines.length ? [["", <b key="t">Total</b>, <b key="d">{money(tb.debitCents)}</b>, <b key="c">{money(tb.creditCents)}</b>]] : []),
          ]}
        />
      </Card>

      {detail && (
        <Card title={`General ledger: ${detail.account.code} ${detail.account.name}`} note={`${from} to ${to}. Opening balance ${money(detail.openingCents)}.`}>
          <Table
            head={["Date", "Entry", "Memo", "Debit", "Credit", "Balance"]}
            empty="No activity in this period."
            rows={detail.rows.map((r) => [r.entry.entryDate, `#${r.entry.id}`, r.line.memo || r.entry.memo, r.line.debitCents ? money(r.line.debitCents) : "", r.line.creditCents ? money(r.line.creditCents) : "", money(r.balanceCents)])}
          />
        </Card>
      )}
    </div>
  );
}
