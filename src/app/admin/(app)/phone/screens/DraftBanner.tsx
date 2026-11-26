import { SubmitButton } from "@/components/staff/SubmitButton";
import { draftChanges, newWordsInDraft } from "@/lib/screen-drafts";
import { screenLabel } from "@/lib/ivr/screens";
import { discardScreensAction, publishScreensAction, undoScreensAction } from "./actions";

/**
 * Phone screens draft banner (Admin handoff Phase 3, Nov 26, 2026): what is changed but not live yet, with Publish
 * (a reason is required and kept in the history), Discard, and Undo the last publish.
 */
export default async function DraftBanner({ screen = "" }: { screen?: string }) {
  const changed = await draftChanges();
  const words = changed.length ? await newWordsInDraft() : [];
  return (
    <section className={`card mb-4 p-4 ${changed.length ? "border-2 border-[#E8C547]" : ""}`} data-screens-draft>
      {changed.length ? (
        <>
          <p className="font-bold">Draft changes, not live yet: {changed.length} screen{changed.length === 1 ? "" : "s"}</p>
          <p className="text-sm text-muted">
            Callers still hear the live screens. Changed: {changed.map((id) => screenLabel(id)).join("; ")}. Publish to make every change live at once, or discard the draft.
          </p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <form action={publishScreensAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="screen" value={screen} />
              <input name="reason" required minLength={3} className="input w-auto min-w-[14rem]" placeholder="Reason (kept in the history)" />
              {words.length > 0 && (
                <div className="w-full rounded-xl bg-[#FFF8E1] p-3 text-sm" data-new-words>
                  <p className="font-semibold">New words callers will hear or get (no recording yet, or a text key):</p>
                  <ul className="mt-1 list-disc pl-5">{words.map((w, i) => <li key={i}>{screenLabel(w.screen)}: {w.kind === "text" ? "texted" : "spoken"} &ldquo;{w.words}&rdquo;</li>)}</ul>
                  <label className="mt-2 flex items-center gap-2 font-semibold"><input type="checkbox" name="approveWords" /> I approve these exact words</label>
                </div>
              )}
              <SubmitButton pendingLabel="Publishing...">Publish (make live)</SubmitButton>
            </form>
            <form action={discardScreensAction}>
              <input type="hidden" name="screen" value={screen} />
              <button className="rounded-full px-3 py-1 text-sm font-semibold text-[#C83A2F] underline">Discard the draft</button>
            </form>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted">No draft changes: callers hear exactly what is shown. A change you make here is saved as a draft first.</p>
          <form action={undoScreensAction}>
            <input type="hidden" name="screen" value={screen} />
            <button className="text-sm font-semibold text-navy underline">Undo the last publish</button>
          </form>
        </div>
      )}
    </section>
  );
}
