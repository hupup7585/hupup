import Link from "next/link";
import { desc, inArray, lte, sql } from "drizzle-orm";
import { requireOwner } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { configDefs } from "@/lib/config-registry";
import { ACCOUNTANT_NOTE } from "@/lib/config-explanations";
import { db, schema } from "@/lib/db";
import { featureSwitches } from "@/lib/feature-switches";
import { unwrap } from "@/lib/config-versions";
import { discardAction, publishAction, saveDraftAction, undoAction } from "./actions";
import { OK_MESSAGES } from "./messages";

export const metadata = { title: "All settings | Hup Up Attractions" };
export const dynamic = "force-dynamic";

const show = (v: unknown) => (v === true ? "On" : v === false ? "Off" : String(v ?? "") === "" ? "(blank)" : String(v));

/**
 * All settings (Admin handoff Phase 2, Abraham, Nov 26, 2026), Owner only: every Admin setting in one place with its
 * live value, default, explanation and where it is used. Changes are drafts until published; every change is kept
 * (history and Undo). Structured values link to their own pages. Feature switches show what is still set in code.
 */
export default async function ConfigPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; q?: string; k?: string }> }) {
  await requireOwner();
  const sp = await searchParams;
  const live = (await getSettings()) as Record<string, unknown>;
  const q = (sp.q ?? "").trim().toLowerCase();
  const defs = configDefs().filter((d) => !q || `${d.key} ${d.label} ${d.help} ${d.group}`.toLowerCase().includes(q));
  // Only the newest 10 versions of each setting (Hark's review L7); the page shows 10 and the history stays complete
  const ranked = db
    .select({ id: schema.configVersions.id, rn: sql<number>`row_number() over (partition by ${schema.configVersions.key} order by ${schema.configVersions.id} desc)`.as("rn") })
    .from(schema.configVersions)
    .where(inArray(schema.configVersions.key, defs.length ? defs.map((d) => d.key) : [""]))
    .as("ranked");
  const newest = defs.length ? (await db.select({ id: ranked.id }).from(ranked).where(lte(ranked.rn, 10))).map((r) => r.id) : [];
  const versions = newest.length ? await db.select().from(schema.configVersions).where(inArray(schema.configVersions.id, newest)).orderBy(desc(schema.configVersions.id)) : [];
  const byKey = new Map<string, typeof versions>();
  for (const v of versions) byKey.set(v.key, [...(byKey.get(v.key) ?? []), v]);
  const groups = [...new Set(defs.map((d) => d.group))].sort();
  return (
    <div className="w-full" data-config-page>
      <h1 className="text-2xl font-black sm:text-3xl">All settings</h1>
      <p className="mb-4 mt-1 text-muted">Every setting in one place. A change is saved as a draft first; customers see nothing until you publish it. Every change is kept, with who changed it and when, and can be undone.</p>
      {sp.ok && sp.ok in OK_MESSAGES && <p className="mb-4 rounded-xl bg-mint/15 p-3 font-semibold text-[#13895C]" role="status">{OK_MESSAGES[sp.ok as keyof typeof OK_MESSAGES]}</p>}
      {sp.err && <p className="mb-4 rounded-xl bg-[#FFE6E4] p-3 font-semibold text-[#C83A2F]" role="alert">{sp.err}</p>}
      <form className="mb-5 flex gap-2" role="search">
        <input name="q" defaultValue={sp.q ?? ""} className="input max-w-md" placeholder="Search settings, for example hold, tax, ring" />
        <button className="btn-dark">Search</button>
      </form>
      {groups.map((g) => (
        <section key={g} className="card mb-5 p-5" data-config-group={g}>
          <h2 className="mb-3 text-xl font-black">{g}</h2>
          <div className="grid gap-4">
            {defs
              .filter((d) => d.group === g)
              .map((d) => {
                const hist = byKey.get(d.key) ?? [];
                const draft = hist.find((v) => v.status === "draft");
                const lastLive = hist.find((v) => v.status === "live");
                const current = String((draft ? unwrap(draft.value) : live[d.key]) ?? "");
                return (
                  <div key={d.key} id={d.key} className="rounded-xl border border-line p-3" data-config-key={d.key}>
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-bold">{d.label}</span>
                      <span className="rounded-full bg-mint/20 px-2 text-xs font-bold text-[#13895C]">Live: {show(live[d.key])}</span>
                      {draft && <span className="rounded-full bg-[#FFF8E1] px-2 text-xs font-bold text-[#5C4600]" data-config-draft>Draft: {show(unwrap(draft.value))}</span>}
                      {d.wording && <span className="rounded-full bg-[#E8F0FB] px-2 text-xs font-bold text-navy">Customer words</span>}
                    </div>
                    {d.explain ? (
                      <dl className="mt-1 grid gap-0.5 text-sm" data-config-explain>
                        <div><dt className="inline font-semibold">What it does: </dt><dd className="inline text-muted">{d.explain.what}</dd></div>
                        <div><dt className="inline font-semibold">Where it is used: </dt><dd className="inline text-muted">{d.explain.where}</dd></div>
                        <div><dt className="inline font-semibold">Now: </dt><dd className="inline text-muted">{show(live[d.key])}</dd></div>
                        {d.explain.source && <div><dt className="inline font-semibold">Where the number comes from: </dt><dd className="inline text-muted">{d.explain.source}</dd></div>}
                        {d.explain.calculation && <div><dt className="inline font-semibold">How it is worked out: </dt><dd className="inline text-muted">{d.explain.calculation}</dd></div>}
                        {d.explain.example && <div><dt className="inline font-semibold">Example: </dt><dd className="inline text-muted">{d.explain.example}</dd></div>}
                        <div><dt className="inline font-semibold">If you change it: </dt><dd className="inline text-muted">{d.explain.ifChanged}</dd></div>
                        {d.explain.askAccountant && <div className="font-semibold text-[#5C4600]">{ACCOUNTANT_NOTE}</div>}
                      </dl>
                    ) : (
                      d.help && <p className="text-sm text-muted">{d.help}</p>
                    )}
                    <p className="text-xs text-muted">
                      Default: {show(d.default)}
                      {d.min !== undefined ? ` · lowest ${d.min}` : ""}
                      {d.max !== undefined ? ` · highest ${d.max}` : ""}
                      {d.usedBy.length ? ` · used in ${d.usedBy.length} place${d.usedBy.length === 1 ? "" : "s"}: ${d.usedBy.slice(0, 4).join(", ")}${d.usedBy.length > 4 ? "…" : ""}` : ""}
                    </p>
                    {d.mode === "locked" ? (
                      <p className="mt-2 text-sm font-semibold text-[#5C4600]" data-config-locked>Locked: {d.locked}{d.page ? <> <Link className="text-navy underline" href={d.page}>Open its page</Link></> : null}</p>
                    ) : d.mode === "page" ? (
                      <p className="mt-2 text-sm" data-config-page-link>
                        Changed and checked on its own page: <Link className="text-navy underline" href={d.page!}>open it</Link>. Every change there is kept in the history below.
                      </p>
                    ) : (
                      <form action={saveDraftAction} className="mt-2 flex flex-wrap items-end gap-2">
                        <input type="hidden" name="key" value={d.key} />
                        <input type="hidden" name="type" value={d.type} />
                        {d.type === "bool" ? (
                          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="value" defaultChecked={Boolean(draft ? unwrap(draft.value) : live[d.key])} /> On</label>
                        ) : d.type === "choice" ? (
                          <select name="value" defaultValue={current} className="input w-auto">{d.choices?.map((c) => <option key={c}>{c}</option>)}</select>
                        ) : d.type === "list" || d.type === "text" ? (
                          <textarea name="value" rows={3} defaultValue={current} className="input min-w-[18rem] flex-1" />
                        ) : (
                          <input name="value" defaultValue={current} className="input w-auto min-w-[10rem]" inputMode={d.type === "int" || d.type === "number" ? "decimal" : undefined} />
                        )}
                        <input name="reason" required minLength={3} className="input w-auto min-w-[12rem]" placeholder="Reason (kept in the history)" />
                        <button className="btn-dark">Save draft</button>
                      </form>
                    )}
                    {draft && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <form action={publishAction} className="flex items-center gap-2">
                          <input type="hidden" name="key" value={d.key} />
                          <input type="hidden" name="version" value={draft.id} />
                          {d.wording && <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="approveWords" /> I approve these exact words</label>}
                          <button className="btn-dark">Publish (make live)</button>
                        </form>
                        <form action={discardAction}><input type="hidden" name="key" value={d.key} /><input type="hidden" name="version" value={draft.id} /><button className="rounded-full px-3 py-1 text-sm font-semibold text-[#C83A2F] underline">Discard draft</button></form>
                      </div>
                    )}
                    {lastLive && d.mode === "edit" && !draft && (
                      <form action={undoAction} className="mt-1"><input type="hidden" name="key" value={d.key} /><button className="text-xs font-semibold text-navy underline">Undo the last published change</button></form>
                    )}
                    {hist.length > 0 && (
                      <details className="mt-1 text-xs">
                        <summary className="cursor-pointer text-muted">History ({hist.length})</summary>
                        <ul className="mt-1 grid gap-1">
                          {hist.slice(0, 10).map((v) => (
                            <li key={v.id}>{new Date(v.createdAt).toLocaleString("en-US", { timeZone: "America/New_York" })}: {v.status} · {show(unwrap(v.previous))} → {show(unwrap(v.value))}{v.reason ? ` · ${v.reason}` : ""}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                );
              })}
          </div>
        </section>
      ))}
      <section className="card mb-5 p-5" data-feature-switches>
        <h2 className="mb-1 text-xl font-black">Feature switches</h2>
        <p className="mb-3 text-sm text-muted">Features that are on, off or preview only. Those set in code show &ldquo;Needs Claude to connect&rdquo; until they can be switched here.</p>
        <table className="w-full text-sm">
          <thead><tr><th className="th">Feature</th><th className="th">Now</th><th className="th">Switch here</th><th className="th">Waits for</th></tr></thead>
          <tbody>
            {featureSwitches(live).map((f) => (
              <tr key={f.id} data-switch={f.id}>
                <td className="td font-semibold">{f.label}</td>
                <td className="td">{f.state}</td>
                <td className="td">{f.settingKey ? <Link className="text-navy underline" href={{ pathname: "/admin/config", query: { q: f.settingKey } }}>Switch it</Link> : <span className="text-muted">Needs Claude to connect</span>}</td>
                <td className="td text-muted">{f.waitsFor}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
