"use client";

import { useState, useTransition } from "react";
import { Star } from "lucide-react";
import { toggleStarAction } from "../actions";

export default function StarButton({ id, starred }: { id: number; starred: boolean }) {
  const [on, setOn] = useState(starred);
  const [, start] = useTransition();
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm hover:bg-bg"
      onClick={() => {
        setOn(!on);
        start(async () => void (await toggleStarAction(id, !on)));
      }}
      data-star={on ? "on" : "off"}
    >
      <Star className={`h-4 w-4 ${on ? "fill-[#FFD229] text-[#E5B800]" : ""}`} aria-hidden /> {on ? "Starred" : "Star"}
    </button>
  );
}
