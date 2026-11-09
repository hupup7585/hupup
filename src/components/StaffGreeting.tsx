import type { StaffUser } from "@/lib/auth";
import { OWNER_FIRST_NAME } from "@/lib/config";

/** "Good Morning" / "Good Afternoon" / "Good Evening" in the business time zone (Abraham: both words capitalized). */
export function greetingFor(date = new Date(), tz = process.env.BUSINESS_TIMEZONE || "America/New_York") {
  const h = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(date));
  return h < 12 ? "Good Morning" : h < 18 ? "Good Afternoon" : "Good Evening";
}

/** The signed-in staff member's first name. The Owner's account may still be named "Owner": that shows Abraham. */
export function staffFirstName(staff: Pick<StaffUser, "name" | "role">) {
  const first = (staff.name || "").trim().split(/\s+/)[0] || "";
  if (staff.role === "owner" && (!first || first.toLowerCase() === "owner")) return OWNER_FIRST_NAME;
  return first || "there";
}

/** Clear waving-hand line icon: yellow #FFD84D fill, navy #123D73 outline, the height of the text. */
export function WavingHand({ className = "" }: { className?: string }) {
  return (
    <svg
      data-waving-hand
      viewBox="-2 -2 27 27"
      aria-hidden="true"
      className={`inline-block h-[1em] w-[1em] shrink-0 align-[-0.14em] ${className}`}
      fill="none"
      stroke="#123D73"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <g transform="rotate(-14 13 13)">
        {/* yellow fill (no outline) */}
        <g fill="#FFD84D" stroke="none">
          <rect x="6" y="4" width="4" height="12" rx="2" />
          <rect x="10" y="2" width="4" height="10" rx="2" />
          <rect x="14" y="4" width="4" height="9" rx="2" />
          <rect x="18" y="6" width="4" height="9" rx="2" />
          <path d="M6 11h16v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15z" />
        </g>
        {/* navy outline */}
        <path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2" />
        <path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2" />
        <path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8" />
        <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
      </g>
      {/* motion lines */}
      <path d="M2.2 6.2a7 7 0 0 1 3-4.4" />
      <path d="M-0.6 5.2a10 10 0 0 1 3.6-6" />
    </svg>
  );
}

/** "Good Morning, Abraham 👋" for whoever is signed in. */
export default function StaffGreeting({ staff, as: Tag = "h1", className = "text-2xl font-black sm:text-3xl" }: { staff: Pick<StaffUser, "name" | "role">; as?: "h1" | "p"; className?: string }) {
  return (
    <Tag className={className} data-greeting>
      {greetingFor()}, {staffFirstName(staff)}
      <span className="ml-2 inline-flex">
        <WavingHand />
      </span>
    </Tag>
  );
}
