import { requireAdmin } from "@/lib/auth";
import { blockedNumbers } from "@/lib/phonepay-watch";
import { formatPhone } from "@/lib/phone";
import { dualDateTime } from "@/lib/dual-date";
import { unlockCardBlockAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Card blocks · Hup Up Attractions", robots: { index: false } };

/**
 * Numbers blocked from card payment by phone (Abraham, Nov 17, 2026), after too many declines in 24 hours. The Owner
 * and the secretary can unlock a number; until then that caller is offered the payment link instead.
 */
export default async function CardBlocksPage() {
  await requireAdmin();
  const rows = await blockedNumbers();
  return (
    <div className="mx-auto max-w-3xl" data-card-blocks>
      <h1 className="text-2xl font-black sm:text-3xl">Card blocks</h1>
      <p className="mb-5 mt-1 text-muted">
        Phone numbers that can&rsquo;t pay by card on the phone after too many declines in 24 hours. These callers are offered the payment link instead. Unlock a number after
        you&rsquo;ve spoken with the customer.
      </p>
      <div className="card p-5">
        {rows.length === 0 && <p className="text-sm text-muted">No blocked numbers.</p>}
        {rows.map((r) => (
          <form key={r.id} action={unlockCardBlockAction} className="mb-2 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-bg p-3">
            <input type="hidden" name="id" value={r.id} />
            <span>
              <b>{formatPhone(r.phone)}</b>
              <span className="block text-sm text-muted">
                Blocked {dualDateTime(r.blockedAt)} · {r.declines} declines in 24 hours
              </span>
            </span>
            <button className="btn-dark">Unlock</button>
          </form>
        ))}
      </div>
    </div>
  );
}
