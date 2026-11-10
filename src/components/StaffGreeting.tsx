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

/** "Good Morning, Abraham" for whoever is signed in (no emoji or icon, Abraham). */
export default function StaffGreeting({ staff, as: Tag = "h1", className = "text-2xl font-black sm:text-3xl" }: { staff: Pick<StaffUser, "name" | "role">; as?: "h1" | "p"; className?: string }) {
  return (
    <Tag className={className} data-greeting>
      {greetingFor()}, {staffFirstName(staff)}
    </Tag>
  );
}
