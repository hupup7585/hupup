import { requireAdmin } from "@/lib/auth";
import { CHECK_LABELS, REVIEW_INTERVAL_DAYS, complianceSnapshot, isOwnerSession } from "@/lib/compliance";
import { formatPhone } from "@/lib/phone";
import { CompleteReviewForm, ReportIssueForm } from "./Forms";

const fmt = (d: Date | null) => (d ? d.toLocaleString("en-US", { timeZone: process.env.BUSINESS_TIMEZONE || "America/New_York" }) : "never");

/** SMS compliance monitoring (policy section 12). Review is Owner-only; any staff member can report an issue. */
export default async function CompliancePage() {
  const session = await requireAdmin();
  const owner = await isOwnerSession(session.userId);
  if (!owner) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-1 text-2xl font-black sm:text-3xl">Report a compliance issue</h1>
        <p className="mb-5 text-muted">Report any suspected SMS compliance problem or unauthorized access to customer information right away. The owner is notified immediately.</p>
        <div className="card p-5"><ReportIssueForm /></div>
      </div>
    );
  }
  const s = await complianceSnapshot();
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <h1 className="mb-1 text-2xl font-black sm:text-3xl">SMS compliance</h1>
        <p className="text-muted">Last {s.days} days. Review at least every {REVIEW_INTERVAL_DAYS} days: system checks, employee access, consent records, opt-outs, and promotional messages.</p>
      </div>

      <div className={`card p-5 ${s.reviewOverdue ? "border-2 border-coral" : ""}`}>
        <h2 className="mb-1 font-bold">Periodic review</h2>
        <p className="mb-3 text-sm">Last review: <b>{fmt(s.lastReview)}</b>{s.reviewOverdue && <span className="ml-2 font-bold text-coral">Review due</span>}</p>
        <CompleteReviewForm />
      </div>

      <div className="card p-5">
        <h2 className="mb-2 font-bold">Automatic checks {s.findings.length ? <span className="text-coral">({s.findings.length} to look at)</span> : <span className="text-[#13895C]">(no problems found)</span>}</h2>
        {s.findings.length > 0 && (
          <table className="w-full text-sm">
            <thead><tr><th className="th">When</th><th className="th">Check</th><th className="th">Phone</th><th className="th">Detail</th></tr></thead>
            <tbody>{s.findings.slice(0, 100).map((f, i) => <tr key={i}><td className="td">{fmt(f.at)}</td><td className="td font-semibold">{CHECK_LABELS[f.check] ?? f.check}</td><td className="td">{formatPhone(f.phone)}</td><td className="td">{f.detail}</td></tr>)}</tbody>
          </table>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="mb-2 font-bold">Consent records</h2>
          <ul className="space-y-1 text-sm">{Object.entries(s.consentCounts).map(([k, n]) => <li key={k}>{k.replace(":", " · ").replace("_", " ")}: <b>{n}</b></li>)}{!Object.keys(s.consentCounts).length && <li className="text-muted">None in this period.</li>}</ul>
          <p className="mt-3 text-sm">Staff entries and corrections: <b>{s.staffEntries.length}</b></p>
        </div>
        <div className="card p-5">
          <h2 className="mb-2 font-bold">Promotional messages</h2>
          <p className="text-sm">Total: <b>{s.promoTotal}</b></p>
          <ul className="mt-1 space-y-1 text-sm">{Object.entries(s.promoByStatus).map(([k, n]) => <li key={k}>{k}: <b>{n}</b></li>)}</ul>
        </div>
      </div>

      <div className="card p-5">
        <h2 className="mb-2 font-bold">Opt-outs processed ({s.optOuts.length})</h2>
        <table className="w-full text-sm">
          <thead><tr><th className="th">When</th><th className="th">Phone</th><th className="th">Program</th><th className="th">How</th></tr></thead>
          <tbody>{s.optOuts.slice(0, 50).map((o) => <tr key={o.id}><td className="td">{fmt(o.createdAt)}</td><td className="td">{formatPhone(o.phone)}</td><td className="td">{o.scope}</td><td className="td">{o.keyword ?? o.source}</td></tr>)}</tbody>
        </table>
      </div>

      <div className="card p-5">
        <h2 className="mb-2 font-bold">Employee access</h2>
        <table className="w-full text-sm">
          <thead><tr><th className="th">Name</th><th className="th">Role</th><th className="th">Active</th><th className="th">Signed-in sessions</th><th className="th">Latest sign-in</th></tr></thead>
          <tbody>{s.users.map((u) => <tr key={u.id}><td className="td">{u.name}</td><td className="td">{u.role}</td><td className="td">{u.active ? "yes" : "no"}</td><td className="td">{u.activeSessions}</td><td className="td">{fmt(u.lastSignIn)}</td></tr>)}</tbody>
        </table>
        <p className="mt-2 text-sm text-muted">Owner sign-ins without a staff account: {s.ownerLoginSessions}. Deactivate anyone who no longer needs access.</p>
      </div>

      <div className="card p-5">
        <h2 className="mb-2 font-bold">Reported issues ({s.issues.length})</h2>
        <ul className="space-y-2 text-sm">{s.issues.map((i) => <li key={i.id}><b>{fmt(i.createdAt)}</b>: {String((i.after as { description?: string } | null)?.description ?? "")}</li>)}{!s.issues.length && <li className="text-muted">None reported.</li>}</ul>
        <h3 className="mb-2 mt-4 font-semibold">Report a new issue</h3>
        <ReportIssueForm />
      </div>
    </div>
  );
}
