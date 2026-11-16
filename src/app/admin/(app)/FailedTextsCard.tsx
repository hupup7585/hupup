import Link from "next/link";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { formatPhone } from "@/lib/phone";
import { inboxWhen } from "@/lib/inbox-format";

/**
 * Dashboard (Owner): texts that did not go through in the last 7 days, with Twilio's status and reason
 * (Abraham, Nov 16, 2026). Every text is logged with its time, number, kind and Twilio status.
 */
export default async function FailedTextsCard() {
  let rows: { id: number; to: string | null; kind: string | null; event: string | null; status: string | null; code: string | null; error: string | null; at: Date; contact: string | null }[] = [];
  try {
    rows = await db
      .select({ id: schema.messages.id, to: schema.messages.toNumber, contact: schema.messages.contactPhone, kind: schema.messages.kind, event: schema.messages.event, status: schema.messages.status, code: schema.messages.errorCode, error: schema.messages.errorMessage, at: schema.messages.createdAt })
      .from(schema.messages)
      .where(and(eq(schema.messages.direction, "out"), inArray(schema.messages.status, ["failed", "undelivered"]), gte(schema.messages.createdAt, new Date(Date.now() - 7 * 86400_000))))
      .orderBy(desc(schema.messages.createdAt))
      .limit(10);
  } catch {
    return null;
  }
  if (!rows.length) return null;
  return (
    <div className="card mb-5 border-2 border-[#C83A2F] p-5" data-failed-texts>
      <div className="mb-2 flex items-center justify-between">
        <Link href="/admin/messages" className="text-lg font-bold text-[#8A1C14] hover:underline">Texts that did not go through ({rows.length})</Link>
        <span className="text-xs text-muted">Last 7 days</span>
      </div>
      <ul className="space-y-1 text-sm">
        {rows.map((r) => (
          <li key={r.id}>
            <b>{formatPhone(r.to ?? r.contact ?? "")}</b> · {r.event ?? r.kind} · {r.status}
            {r.code ? ` (Twilio ${r.code})` : ""}
            {r.error ? `: ${r.error}` : ""} · <span className="text-muted">{inboxWhen(r.at)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
