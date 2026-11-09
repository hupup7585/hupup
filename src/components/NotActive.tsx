import { CircleAlert } from "lucide-react";
import { blocker } from "@/lib/system-status";

/** "Not active yet: <reason>" (Abraham EE). Shows nothing once the feature is running for real. */
export default async function NotActive({ k }: { k: string }) {
  const b = await blocker(k);
  if (!b || b.active) return null;
  return (
    <p data-not-active={k} className="mb-4 flex items-start gap-2 rounded-xl border border-[#E8B400]/50 bg-[#FFF8E1] px-4 py-3 text-sm text-[#5C4600]">
      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#123D73]" aria-hidden />
      {k === "sms" ? (
        // SMS v3 (Abraham): every texting screen shows exactly this until Twilio approves texting
        <b>Not active yet: waiting for Twilio A2P approval</b>
      ) : (
        <span>
          <b>Not active yet:</b> {b.area}. {b.reason}
        </span>
      )}
    </p>
  );
}
