import { SubmitButton } from "@/components/staff/SubmitButton";
import { draftChanges } from "@/lib/screen-drafts";
import { screenLabel } from "@/lib/ivr/screens";
import { discardScreensAction, publishScreensAction, undoScreensAction } from "./actions";

/**
 * Phone screens draft banner (Admin handoff Phase 3, Nov 26, 2026): what is changed but not live yet, with Publish
 * (a reason is required and kept in the history), Discard, and Undo the last publish.
 */
export default async function DraftBanner({ screen = "" }: { screen?: string }) {
  const changed = await draftChanges();
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
