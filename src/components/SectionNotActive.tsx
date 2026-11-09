import { CircleAlert } from "lucide-react";

export default function SectionNotActive({ title, reason }: { title: string; reason: string }) {
  return (
    <p data-section-not-active={title} className="card mb-5 flex items-start gap-2 border border-[#E8B400]/50 bg-[#FFF8E1] p-4 text-sm text-[#5C4600]">
      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#123D73]" aria-hidden />
      <span>
        <b>{title}: Not active yet:</b> {reason}.
      </span>
    </p>
  );
}
