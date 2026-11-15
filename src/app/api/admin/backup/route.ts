import { currentStaff } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { backupFileName, buildBackup } from "@/lib/backup";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Owner only: download a full backup of the business data (plan step 3). */
export async function GET() {
  const staff = await currentStaff();
  if (!staff) return new Response("Unauthorized", { status: 401 });
  if (staff.role !== "owner") return new Response("Forbidden: backups are owner-only", { status: 403 });
  const b = await buildBackup();
  await db.insert(schema.auditLog).values({ userId: staff.userId, action: "backup.downloaded", entityType: "backup", entityId: "0", after: { tables: b.tables, rows: b.rows } });
  return new Response(new Uint8Array(b.gz), { headers: { "Content-Type": "application/gzip", "Content-Disposition": `attachment; filename="${backupFileName()}"`, "Cache-Control": "no-store" } });
}
