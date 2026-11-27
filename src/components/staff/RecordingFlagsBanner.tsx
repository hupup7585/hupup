import Link from "next/link";
import { getSettings } from "@/lib/settings";
import { flagLine, recordingFlags } from "@/lib/recording-flags";

/** Red banner (Abraham, Nov 27, 2026): every recording slot that needs a new recording because a spoken value changed. */
export default async function RecordingFlagsBanner() {
  const flags = recordingFlags((await getSettings()) as never);
  if (!flags.length) return null;
  return (
    <div role="alert" className="mb-4 rounded-xl border-2 border-[#b3261e] bg-[#ffe6e4] p-4 text-[#b3261e]" data-recording-flags>
      <p className="font-black">{flags.length === 1 ? "1 recording needs a new recording" : `${flags.length} recordings need a new recording`}</p>
      <ul className="mt-1 list-disc pl-5 text-sm font-semibold">
        {flags.map((f) => (
          <li key={`${f.slot}-${f.source}`}>
            <span className="font-mono">{f.slot}</span>: {flagLine(f)}.
          </li>
        ))}
      </ul>
      <p className="mt-1 text-sm">
        The old recording keeps playing until a new one is uploaded and &ldquo;Use this one&rdquo; is pressed.{" "}
        <Link href="/admin/phone/prompts/slots" className="font-bold underline">Open the Recording text list</Link>
      </p>
    </div>
  );
}
