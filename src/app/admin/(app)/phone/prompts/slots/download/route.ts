import { currentStaff } from "@/lib/auth";
import { STATUS_WORDS, slotsWithStatus } from "@/lib/slot-status";

export const dynamic = "force-dynamic";

/** The recording text list as a spreadsheet file (CSV), with each slot's exact text and status. Owner only. */
export async function GET() {
  const staff = await currentStaff();
  if (!staff || staff.role !== "owner") return new Response("Owner only", { status: 403 });
  const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const rows = (await slotsWithStatus()).map((s) => [s.group, s.label, s.key, s.text, STATUS_WORDS[s.status]].map(q).join(","));
  const csv = ["Group,Line,Slot,Exact text,Status", ...rows].join("\r\n");
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="hup-up-recording-text-list.csv"' } });
}
