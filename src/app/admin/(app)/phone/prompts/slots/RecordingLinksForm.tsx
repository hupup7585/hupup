import { getSettings } from "@/lib/settings";
import { recordingLinks } from "@/lib/recording-flags";
import { saveRecordingLinksAction } from "./actions";

/**
 * Settings spoken inside recordings (Abraham, Nov 27, 2026): one line per setting or price, then "=", then the
 * recording slots that say it. Owner only (the page checks it).
 */
export default async function RecordingLinksForm() {
  const links = recordingLinks((await getSettings()) as never);
  const text = links.map((l) => `${l.source} | ${l.label} = ${l.slots.join(", ")}`).join("\n");
  return (
    <details className="card mb-4 p-4" data-recording-links>
      <summary className="cursor-pointer font-bold">Settings spoken inside recordings ({links.length})</summary>
      <p className="mt-2 text-sm text-muted">
        Some recordings say a value that is also a setting or a price (for example the ocean ball prices). When one of these is saved with a new
        value, the recordings listed for it are marked &ldquo;Needs a new recording&rdquo;, their text gets a draft with the new value, a red banner
        lists them here and on the Admin home page, and you get one email. The old recording keeps playing until a new one is uploaded and
        &ldquo;Use this one&rdquo; is pressed. One line each: the setting (setting:name) or price (product:category:size), a short name, then
        &ldquo;=&rdquo; and the recording slots, separated by commas.
      </p>
      <form action={saveRecordingLinksAction} className="mt-2 grid gap-2">
        <textarea name="links" rows={Math.min(14, links.length + 2)} defaultValue={text} className="input font-mono text-xs" />
        <button className="btn-dark w-fit">Save the list</button>
      </form>
    </details>
  );
}
