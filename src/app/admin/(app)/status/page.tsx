import Link from "next/link";
import { CircleAlert, CircleCheck } from "lucide-react";
import { requireOwner } from "@/lib/auth";
import { blockers, scanForTestData } from "@/lib/system-status";
import { recentJobRuns } from "@/lib/jobs";
import { dualDateTime } from "@/lib/dual-date";

export const dynamic = "force-dynamic";
export const metadata = { title: "System status | Hup Up Attractions" };

/** Owner only (Abraham EE): what runs for real, what's waiting on an outside step, and any test data in this database. */
export default async function StatusPage() {
  await requireOwner();
  const [list, found, jobs] = await Promise.all([blockers(), scanForTestData(), recentJobRuns(30).catch(() => [])]);
  return (
    <div className="w-full" data-status>
      <h1 className="mb-1 text-2xl font-black sm:text-3xl">System status</h1>
      <p className="mb-5 text-muted">Everything that runs for real, and what&rsquo;s still waiting on an outside step. Nothing on this page changes any data.</p>
      <section className="card mb-5 p-5" data-backup>
        <h2 className="mb-1 text-lg font-bold">Backups</h2>
        <p className="mb-3 text-sm text-muted">
          A full copy of the business data: orders, customers, payments, the books, calls, voicemail records, emails and settings. Keys, passwords and sign-in codes are never in it. Every Sunday a copy is emailed to you; you can also download one now.
        </p>
        <a href="/api/admin/backup" className="btn-dark">Download a backup now</a>
      </section>
      <section className="card mb-5 p-5" data-job-runs>
        <h2 className="mb-1 text-lg font-bold">Daily jobs</h2>
        <p className="mb-3 text-sm text-muted">Each job runs once a day. If one fails, it tries again up to 3 times, and you are emailed if it still fails.</p>
        {jobs.length === 0 ? (
          <p className="text-sm text-muted">No runs yet. The first run is tonight.</p>
        ) : (
          <table className="w-full text-sm">
            <thead><tr><th className="th">Job</th><th className="th">When</th><th className="th">Result</th><th className="th">Tries</th></tr></thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td className="td">{j.name}</td>
                  <td className="td">{dualDateTime(j.startedAt)}</td>
                  <td className={`td font-semibold ${j.ok ? "text-[#13895C]" : j.ok === false ? "text-[#C83A2F]" : "text-muted"}`}>{j.ok ? "Done" : j.ok === false ? `Failed: ${j.error ?? ""}` : "Running"}</td>
                  <td className="td">{j.attempts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="card mb-5 p-5">
        <h2 className="mb-3 text-lg font-bold">Features</h2>
        <ul className="divide-y divide-line">
          {list.map((b) => (
            <li key={b.key} className="flex items-start gap-3 py-3" data-feature={b.key} data-active={b.active ? "1" : "0"}>
              {b.active ? <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#13895C]" aria-label="Active" /> : <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-[#A87800]" aria-label="Not active yet" />}
              <div className="min-w-0">
                <div className="font-bold">
                  <Link href={b.where} className="hover:underline">{b.area}</Link>
                </div>
                <div className="text-sm text-muted">{b.active ? "Active." : <><b>Not active yet:</b> {b.reason}</>}</div>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section className="card p-5" data-test-data>
        <h2 className="mb-1 text-lg font-bold">Test data check</h2>
        <p className="mb-3 text-sm text-muted">
          Looks for simulated data in this database: 555-01xx phone numbers, example.com emails, and call ids that didn&rsquo;t come from Twilio. Nothing is deleted; anything found waits for Abraham&rsquo;s OK.
        </p>
        {found.length === 0 ? (
          <p className="flex items-center gap-2 font-semibold text-[#13895C]"><CircleCheck className="h-5 w-5" aria-hidden /> No test data found.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {found.map((f, i) => (
              <li key={i}>
                <b>{f.label}</b> <span className="text-muted">({f.table}, {f.ids.length})</span>: <span className="break-all font-mono text-xs">{f.ids.join(", ")}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
