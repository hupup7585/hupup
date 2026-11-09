import { requireStaff } from "@/lib/auth";
import { CAMPAIGNS_NOT_ACTIVE, campaignPreview, campaignsCanSend, eligibleOf, listCampaigns, promoSignups, segments } from "@/lib/campaigns";
import { PROMOS_PER_YEAR } from "@/lib/sms-consent-copy";
import { formatPhone } from "@/lib/phone";
import { alertDateTime } from "@/lib/voicemail";
import { approveCampaignAction, cancelCampaignAction, createCampaignAction, sendCampaignAction } from "./actions";

export const dynamic = "force-dynamic";

const SOURCE: Record<string, string> = { web: "Website", phone: "Phone", keyword: "Text reply", sms_reply: "Text reply", pos: "Staff (New booking)", staff: "Staff" };
const STATUS: Record<string, string> = { draft: "Draft", approved: "Approved, ready to send", sent: "Sent", canceled: "Canceled" };

/** Promo campaigns (Abraham, Nov 9, 2026): Owner writes and approves; Owner or Secretary sends to eligible customers only. */
export default async function CampaignsPage({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  const staff = await requireStaff(["owner", "secretary"]);
  const owner = staff.role === "owner";
  const sp = await searchParams;
  const [signups, campaigns] = await Promise.all([promoSignups(), listCampaigns()]);
  const eligible = eligibleOf(signups);
  const canSend = campaignsCanSend();
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <h1 className="mb-1 text-2xl font-black sm:text-3xl">Campaigns</h1>
        <p className="text-muted">Seasonal promo texts. Only customers who signed up for promos get them, at most {PROMOS_PER_YEAR} a year each. Texts go out between 8 AM and 9 PM in the customer&rsquo;s time.</p>
      </div>
      {!canSend && (
        <p data-not-active="campaigns" className="rounded-xl bg-[#FFF8E1] px-4 py-3 text-sm text-[#5C4600]"><b>{CAMPAIGNS_NOT_ACTIVE}.</b> You can write and approve campaigns now; sending starts once texting is approved.</p>
      )}
      {sp.msg && <p className="rounded-xl bg-[#E3F8EF] px-4 py-3 text-sm font-semibold text-[#13895C]" role="status">{sp.msg}</p>}
      {sp.err && <p className="rounded-xl bg-[#FFE6E4] px-4 py-3 text-sm font-semibold text-[#C83A2F]" role="alert">{sp.err}</p>}

      <div className="grid gap-3 sm:grid-cols-3" data-promo-counts>
        <div className="card p-4"><div className="text-sm text-muted">Signed up for promos</div><div className="text-2xl font-black">{signups.length}</div></div>
        <div className="card p-4"><div className="text-sm text-muted">Can get the next campaign</div><div className="text-2xl font-black">{eligible.length}</div></div>
        <div className="card p-4"><div className="text-sm text-muted">Reached {PROMOS_PER_YEAR} this year</div><div className="text-2xl font-black">{signups.filter((s) => s.status === "At yearly limit").length}</div></div>
      </div>

      <div className="card p-5">
        <h2 className="mb-3 text-lg font-extrabold">Campaigns</h2>
        {campaigns.length === 0 ? (
          <p className="text-muted">No campaigns yet.{owner ? " Write the first one below." : " The Owner writes and approves campaigns; approved ones show here for you to send."}</p>
        ) : (
          <ul className="divide-y divide-line">
            {campaigns.map((c) => {
              const text = campaignPreview(c.body);
              const seg = segments(text);
              return (
                <li key={c.id} className="py-4" data-campaign={c.id}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-bold">{c.name}</div>
                    <span className="rounded-full bg-bg px-3 py-1 text-xs font-bold">{STATUS[c.status] ?? c.status}</span>
                  </div>
                  <p className="mt-2 rounded-lg bg-bg p-3 text-sm" data-campaign-preview>{text}</p>
                  <p className="mt-1 text-xs text-muted">
                    {seg.chars} characters, {seg.segments === 1 ? "1 text segment" : `${seg.segments} text segments (each customer is billed for each segment)`}. Written {alertDateTime(c.createdAt)}
                    {c.approvedAt ? `. Approved ${alertDateTime(c.approvedAt)}` : ""}
                    {c.sentAt ? `. Sent ${alertDateTime(c.sentAt)}: ${c.sentCount ?? 0} sent, ${c.heldCount ?? 0} waiting for 8 AM, ${c.skippedCount ?? 0} skipped` : ""}.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {owner && c.status === "draft" && (
                      <form action={approveCampaignAction}><input type="hidden" name="id" value={c.id} /><button className="btn-dark">Approve wording</button></form>
                    )}
                    {c.status === "approved" && (
                      <form action={sendCampaignAction}>
                        <input type="hidden" name="id" value={c.id} />
                        <button className="btn" disabled={!canSend || eligible.length === 0} title={!canSend ? CAMPAIGNS_NOT_ACTIVE : eligible.length === 0 ? "No customer can get a promo right now" : undefined}>
                          Send to {eligible.length} customer{eligible.length === 1 ? "" : "s"}
                        </button>
                      </form>
                    )}
                    {owner && (c.status === "draft" || c.status === "approved") && (
                      <form action={cancelCampaignAction}><input type="hidden" name="id" value={c.id} /><button className="btn-ghost">Cancel campaign</button></form>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {owner && (
        <div className="card p-5">
          <h2 className="mb-1 text-lg font-extrabold">Write a campaign</h2>
          <p className="mb-3 text-sm text-muted">Write only the offer. The required opening and opt-out line are added for you; the preview shows the exact text. After you approve it, you or the Secretary can send it.</p>
          <form action={createCampaignAction} className="grid gap-3">
            <label className="block" htmlFor="campaign-name">
              <span className="label">Name (only staff see this)</span>
              <input id="campaign-name" name="name" className="input" placeholder="Summer 2027" required />
            </label>
            <label className="block" htmlFor="campaign-body">
              <span className="label">Offer</span>
              <textarea id="campaign-body" name="body" rows={3} className="input" placeholder="Summer special! 15% off paddle boat rentals booked by June 30. Call (845) 415-7585." required />
            </label>
            <button className="btn-dark w-fit">Save draft</button>
          </form>
        </div>
      )}

      <div className="card p-5">
        <h2 className="mb-3 text-lg font-extrabold">Who signed up for promos</h2>
        {signups.length === 0 ? (
          <p className="text-muted">No one has signed up for promo texts yet. Sign-ups come from the website, the phone line, and text replies; each one is confirmed by the customer.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-promo-signups>
              <thead><tr><th className="th">Customer</th><th className="th">Phone</th><th className="th">Signed up</th><th className="th">How</th><th className="th">Promos this year</th><th className="th">Status</th></tr></thead>
              <tbody>
                {signups.map((s) => (
                  <tr key={s.customerId} className="border-t border-line">
                    <td className="py-2"><a className="underline" href={`/admin/customers/${s.customerId}`}>{s.name || "No name yet"}</a></td>
                    <td>{formatPhone(s.phone)}</td>
                    <td>{s.signedUpAt ? alertDateTime(s.signedUpAt) : ""}</td>
                    <td>{s.source ? SOURCE[s.source] ?? s.source : ""}</td>
                    <td>{s.thisYear} of {PROMOS_PER_YEAR}</td>
                    <td>{s.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
