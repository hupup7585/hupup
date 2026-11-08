import Link from "next/link";
import { CircleAlert, CircleCheck } from "lucide-react";
import { requireOwner } from "@/lib/auth";
import { blockers, scanForTestData } from "@/lib/system-status";

export const dynamic = "force-dynamic";
export const metadata = { title: "System status | Hup Up Attractions" };

/** Owner only (Abraham EE): what runs for real, what's waiting on an outside step, and any test data in this database. */
export default async function StatusPage() {
  await requireOwner();
  const [list, found] = await Promise.all([blockers(), scanForTestData()]);
  return (
    <div className="mx-auto max-w-5xl" data-status>
      <h1 className="mb-1 text-2xl font-black sm:text-3xl">System status</h1>
      <p className="mb-5 text-muted">Everything that runs for real, and what&rsquo;s still waiting on an outside step. Nothing on this page changes any data.</p>
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
