import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireOwner } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { allSlots } from "@/lib/recording-slots";
import { customSlots } from "@/lib/custom-slots";
import { catalogItems } from "@/lib/slot-status";
import { PROMPTS, promptArea } from "@/lib/ivr/prompts";
import { RING_KEYS, RING_KEY_LABELS } from "@/lib/ivr/routing";
import { KEY_ACTIONS, defaultLayout, layoutIdFor, parseEditor, type KeyDef, type Line } from "@/lib/ivr/menu-editor";
import { GO_TO_SCREENS, SCREENS, screenArea, screenLabel } from "@/lib/ivr/screens";
import { SCREEN_EXPLANATIONS } from "@/lib/ivr/screen-explanations";
import { previewScreen } from "@/lib/ivr/screen-preview";
import { addLineAction, moveLineAction, removeKeyAction, removeLineAction, setKeyAction, toggleLineAction } from "../actions";

export const dynamic = "force-dynamic";

type Info = { name: string; text: string };

/** One screen (Abraham, Nov 26, 2026): its lines in play order, its combined recording, and its keys. */
export default async function ScreenPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  await requireOwner();
  const { id: raw } = await params;
  const id = decodeURIComponent(raw);
  const s = SCREENS[id];
  if (!s) notFound();
  const sp = await searchParams;
  const preview = await previewScreen(id).catch(() => null); // Test this screen: a preview call, nothing saved
  const [row] = await db.select({ value: schema.appSettings.value }).from(schema.appSettings).where(eq(schema.appSettings.key, "screenEditor")).limit(1);
  const e = parseEditor(row?.value);
  const slots = allSlots(await catalogItems(), {}, await customSlots()).filter((x) => x.kind === "line");
  const recorded = new Set((await db.select({ key: schema.voicePrompts.key, rec: schema.voicePrompts.recordingId }).from(schema.voicePrompts)).filter((r) => r.rec).map((r) => r.key));
  const info = (ref: string): Info => {
    if (ref === "star") return { name: "Shared: go back", text: PROMPTS.book_back.text };
    if (ref === "hours_lines") return { name: "The hours, read from the Hours page", text: "Built from Settings > Hours each call." };
    const p = (PROMPTS as Record<string, { label: string; text: string }>)[ref];
    if (p) return { name: p.label, text: p.text };
    const c = slots.find((x) => x.key === ref);
    return c ? { name: c.label, text: c.text } : { name: ref, text: "" };
  };
  const layouts = [...new Set(s.combos.map(layoutIdFor))];
  const extra = e.extra[id] ?? [];
  const keys = e.keys[id] ?? [];
  const addedHere = [...layouts.flatMap((l) => (e.layouts[l] ?? []).map((x) => x.ref)), ...extra.map((x) => x.ref)].filter((r) => !(r in PROMPTS) && r !== "star" && r !== "hours_lines");
  const byArea = new Map<string, typeof slots>();
  for (const x of slots) {
    const a = x.key in PROMPTS ? promptArea(x.group) : x.group;
    byArea.set(a, [...(byArea.get(a) ?? []), x]);
  }
  const pickList = (name: string, multiple = false) => (
    <select name={name} className="input" multiple={multiple} size={multiple ? 6 : undefined} defaultValue={multiple ? [] : ""}>
      {!multiple && <option value="">Pick a recording from the list</option>}
      {[...byArea.entries()].map(([a, list]) => (
        <optgroup key={a} label={a}>
          {list.map((x) => (
            <option key={x.key} value={x.key}>{`${x.label}: "${x.text.slice(0, 70)}${x.text.length > 70 ? "..." : ""}"${recorded.has(x.key) ? " (recorded)" : ""}`}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
  const LineList = ({ lines, layout }: { lines: Line[]; layout?: string }) => (
    <ol className="mb-3 grid gap-2">
      {lines.map((l, i) => {
        const x = info(l.ref);
        const hidden = { screen: id, layout: layout ?? "", index: String(i) };
        const H = () => <>{Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}</>;
        return (
          <li key={`${l.ref}-${i}`} className={`flex flex-wrap items-start gap-3 rounded-xl border p-3 ${l.on ? "border-line" : "border-dashed border-line opacity-70"}`} data-screen-line={l.ref}>
            <span className="w-6 font-black">{i + 1}.</span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{x.name} {recorded.has(l.ref) ? <span className="text-xs text-[#13895C]">(recorded)</span> : <span className="text-xs text-muted">(Google voice reads the text)</span>}</span>
              <span className="block text-sm text-muted">&ldquo;{x.text}&rdquo;</span>
            </span>
            <form action={toggleLineAction}><H /><input type="hidden" name="on" value={l.on ? "0" : "1"} /><button className={l.on ? "btn-ghost !py-1 text-sm" : "btn-dark !py-1 text-sm"}>{l.on ? "On: turn off" : "Off: turn on"}</button></form>
            <form action={moveLineAction}><H /><input type="hidden" name="dir" value="up" /><button className="btn-ghost !py-1 text-sm" disabled={i === 0}>Up</button></form>
            <form action={moveLineAction}><H /><input type="hidden" name="dir" value="down" /><button className="btn-ghost !py-1 text-sm" disabled={i === lines.length - 1}>Down</button></form>
            {(!layout || addedHere.includes(l.ref)) && <form action={removeLineAction}><H /><button className="text-sm font-bold text-[#C83A2F]">Remove</button></form>}
          </li>
        );
      })}
    </ol>
  );
  const AddForm = ({ layout, count }: { layout?: string; count: number }) => (
    <form action={addLineAction} className="grid gap-2 rounded-xl bg-bg p-3 md:grid-cols-2">
      <input type="hidden" name="screen" value={id} />
      <input type="hidden" name="layout" value={layout ?? ""} />
      <label className="block md:col-span-2"><span className="label">Add a recording from the list</span>{pickList("ref")}</label>
      <label className="block"><span className="label">Or a new line: its name</span><input name="name" className="input" placeholder="e.g. Holiday note" /></label>
      <label className="block"><span className="label">Its exact words (the Google voice reads them until it is recorded)</span><input name="text" className="input" /></label>
      <label className="block"><span className="label">Where</span>
        <select name="at" className="input" defaultValue="">
          <option value="0">At the start</option>
          {Array.from({ length: count }, (_, i) => <option key={i} value={String(i + 1)}>After line {i + 1}</option>)}
          <option value="">At the end</option>
        </select>
      </label>
      <div className="flex items-end"><button className="btn-dark">Add (starts off)</button></div>
    </form>
  );
  const keyName = (k: KeyDef) => {
    const a = k.action;
    return a.type === "screen" ? `Go to ${screenLabel(a.target)}`
      : a.type === "ring" ? `Ring ${RING_KEY_LABELS[a.ext as keyof typeof RING_KEY_LABELS] ?? a.ext}`
      : a.type === "voicemail" ? `Voicemail box ${a.box === "9" ? "General Voicemail (key 9)" : RING_KEY_LABELS[a.box as keyof typeof RING_KEY_LABELS] ?? a.box}`
      : a.type === "play" ? `Play ${a.lines.map((r) => info(r).name).join(", ")}, then this menu again`
      : a.type === "text" ? `Text the caller: "${a.text}"${a.picture ? " with a picture" : ""}`
      : a.type === "forward" ? `Forward the call to ${a.phone}`
      : a.type === "item" ? `Add item number ${a.productId}`
      : "Go back (the same as star)";
  };
  const products = await catalogItems();
  return (
    <div className="w-full" data-screen-editor={id}>
      <p className="mb-2 text-sm"><Link className="text-navy underline" href="/admin/phone/screens">All phone screens</Link> · {screenArea(id)}</p>
      <h1 className="text-2xl font-black sm:text-3xl">{screenLabel(id)}</h1>
      {SCREEN_EXPLANATIONS[id] && (
        <dl className="mt-2 grid gap-0.5 text-sm" data-screen-explain>
          <div><dt className="inline font-semibold">What it does: </dt><dd className="inline text-muted">{SCREEN_EXPLANATIONS[id].what}</dd></div>
          <div><dt className="inline font-semibold">Where the caller meets it: </dt><dd className="inline text-muted">{SCREEN_EXPLANATIONS[id].where}</dd></div>
          <div><dt className="inline font-semibold">Now: </dt><dd className="inline text-muted">{s.lines.length} recorded lines; keys that work here: {s.keys ? s.keys.split("").join(", ") : "none (the caller types or speaks)"}.</dd></div>
          <div><dt className="inline font-semibold">If you change it: </dt><dd className="inline text-muted">{SCREEN_EXPLANATIONS[id].ifChanged}</dd></div>
        </dl>
      )}
      <details className="card my-3 p-4" data-screen-test>
        <summary className="cursor-pointer font-bold">Test this screen</summary>
        {preview ? (
          <>
            <p className="mt-2 text-sm text-muted">Exactly what a caller gets on this screen right now, with the live recordings, Admin keys and timing. Run as a preview: nothing is saved and nothing shows in the call log.</p>
            <ol className="mt-2 grid gap-1 text-sm" data-screen-test-steps>
              {preview.steps.map((x, i) => <li key={i} className="whitespace-pre-wrap">{x.text}</li>)}
            </ol>
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer text-muted">The phone instructions sent to Twilio (for checking)</summary>
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-bg p-2">{preview.xml}</pre>
            </details>
          </>
        ) : (
          <p className="mt-2 text-sm text-muted">
            This screen depends on what the caller did before (a cart, an order or an earlier answer), so it cannot be run on its own here. Its lines, in play order, are listed
            below with their keys; the wait is on Phone timing. A test call on the preview site shows it in full.
          </p>
        )}
      </details>
      {sp.ok && <p className="my-3 rounded-xl bg-mint/15 p-3 font-semibold text-[#13895C]" role="status">{sp.ok === "1" ? "Saved, live now." : sp.ok}</p>}
      {sp.err && <p className="my-3 rounded-xl bg-[#FFE6E4] p-3 font-semibold text-[#C83A2F]" role="alert">{sp.err}</p>}

      {layouts.length === 0 && (
        <section className="card my-5 p-5">
          <h2 className="mb-2 text-lg font-black">What this screen plays now (as built)</h2>
          <p className="mb-2 text-sm text-muted">These lines are built into this step (some only in certain calls, with the changing parts filled in). Change their recordings on Phone recordings; add lines at the end below.</p>
          <ol className="grid gap-1 text-sm">{s.lines.map((r, i) => <li key={r}>{i + 1}. <b>{info(r).name}</b>: &ldquo;{info(r).text}&rdquo;</li>)}</ol>
        </section>
      )}

      {layouts.map((l) => {
        const lines = e.layouts[l] ?? defaultLayout(l);
        const combos = s.combos.filter((c) => layoutIdFor(c) === l);
        return (
          <section key={l} className="card my-5 p-5" data-screen-layout={l}>
            <h2 className="mb-1 text-lg font-black">Lines in play order</h2>
            <p className="mb-3 text-sm text-muted">Turn lines on or off, move them, or add a line anywhere. Changing parts (dates, prices, names, totals) still come from the system. A key press is not added by a line; set keys below.</p>
            <LineList lines={lines} layout={l} />
            <AddForm layout={l} count={lines.length} />
            <div className="mt-3 text-sm">
              Combined recording:{" "}
              {combos.map((c) => (
                <span key={c} className="mr-3">
                  <Link className="text-navy underline" href={`/admin/phone/prompts?q=whole_${c}`}>{(PROMPTS as Record<string, { label: string }>)[`whole_${c}`]?.label ?? `whole_${c}`}</Link>{" "}
                  {recorded.has(`whole_${c}`) ? <b className="text-[#13895C]">in use (plays instead of the lines above)</b> : <span className="text-muted">not in use</span>}
                </span>
              ))}
            </div>
          </section>
        );
      })}

      {s.choice && (
        <section className="card my-5 p-5" data-screen-extra>
          <h2 className="mb-1 text-lg font-black">Lines at the end of this screen</h2>
          <p className="mb-3 text-sm text-muted">Played after this screen&rsquo;s own lines, while it waits for a key. Use these for a new key&rsquo;s line.</p>
          <LineList lines={extra} />
          <AddForm count={extra.length} />
        </section>
      )}

      {s.choice && (
        <section className="card my-5 p-5" data-screen-keys>
          <h2 className="mb-1 text-lg font-black">Keys</h2>
          <p className="mb-3 text-sm text-muted">Star (go back) and pound (skip) stay as built. A key this screen does not use yet works only once its line is added and turned on.</p>
          <table className="mb-4 w-full text-sm">
            <thead><tr><th className="th">Key</th><th className="th">Now</th><th className="th"></th></tr></thead>
            <tbody>
              {"1234567890".split("").map((d) => {
                const own = keys.find((k) => k.key === d);
                return (
                  <tr key={d}>
                    <td className="td font-black">{d}</td>
                    <td className="td">
                      {own ? <>{keyName(own)} {own.on ? <b className="text-[#13895C]">(on)</b> : <span className="text-muted">(off)</span>}{own.line ? <span className="text-muted"> · line: {info(own.line).name}</span> : null}</> : s.keys.includes(d) ? "As built" : <span className="text-muted">Not used</span>}
                    </td>
                    <td className="td">{own && <form action={removeKeyAction}><input type="hidden" name="screen" value={id} /><input type="hidden" name="key" value={d} /><button className="text-xs font-bold text-[#C83A2F]">Back to as built</button></form>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <form action={setKeyAction} className="grid gap-3 rounded-xl bg-bg p-3 md:grid-cols-3">
            <input type="hidden" name="screen" value={id} />
            <label className="block"><span className="label">Key</span><select name="key" className="input">{"1234567890".split("").map((d) => <option key={d} value={d}>{d}{s.keys.includes(d) ? " (used now: this changes it)" : ""}</option>)}</select></label>
            <label className="block"><span className="label">What it does</span><select name="type" className="input">{Object.entries(KEY_ACTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="block"><span className="label">Its line (for a new key)</span><select name="line" className="input" defaultValue=""><option value="">None</option>{addedHere.map((r) => <option key={r} value={r}>{info(r).name}</option>)}</select></label>
            <label className="block"><span className="label">Go to (menu or step)</span><select name="target" className="input">{GO_TO_SCREENS.map((x) => <option key={x} value={x}>{x in SCREENS ? screenLabel(x) : x === "menu" ? "Main menu" : x}</option>)}</select></label>
            <label className="block"><span className="label">Ring (extension)</span><select name="ext" className="input">{RING_KEYS.map((k) => <option key={k} value={k}>{RING_KEY_LABELS[k]}</option>)}</select></label>
            <label className="block"><span className="label">Voicemail box</span><select name="box" className="input">{RING_KEYS.map((k) => <option key={k} value={k}>{RING_KEY_LABELS[k]}</option>)}<option value="9">General Voicemail (key 9)</option></select></label>
            <label className="block md:col-span-2"><span className="label">Play these recordings (hold Ctrl to pick several)</span>{pickList("lines", true)}</label>
            <label className="block"><span className="label">Add this item</span><select name="productId" className="input">{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label className="block md:col-span-2"><span className="label">Text to send</span><input name="text" className="input" /></label>
            <label className="block"><span className="label">Picture link for a picture text (optional)</span><input name="picture" className="input" placeholder="https://..." /></label>
            <label className="block"><span className="label">Forward to phone number</span><input name="phone" className="input" placeholder="845-555-0123" /></label>
            <label className="flex items-center gap-2 font-semibold"><input type="checkbox" name="on" /> On</label>
            <div className="flex items-end"><button className="btn-dark">Save key</button></div>
          </form>
          <p className="mt-2 text-xs text-muted">Only the box that matches &ldquo;What it does&rdquo; is used.</p>
        </section>
      )}
    </div>
  );
}

