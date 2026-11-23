import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { DIRECTORY_COLUMNS } from "@/lib/directory-list";
import DirectoryPreviewForm from "./DirectoryPreviewForm";
import AddNameForm from "./AddNameForm";

export const dynamic = "force-dynamic";

/** Owner only (Abraham, Nov 22, 2026): the community directory list for the phone address lookup. Separate from customers. */
export default async function DirectoryPage() {
  await requireOwner();
  const { directoryCount } = await import("@/lib/directory");
  const now = await directoryCount().catch(() => ({ rows: 0, phones: 0, shared: 0 }));
  // Add a name (Abraham, Nov 23, 2026): the streets list, the zips, and the names added this way (still there)
  const { STREETS, ZIP_CODES } = await import("@/lib/streets");
  const { townForZip } = await import("@/lib/orange-zips");
  const { db, schema } = await import("@/lib/db");
  const { and, desc, eq, inArray } = await import("drizzle-orm");
  const log = await db
    .select({ id: schema.auditLog.entityId })
    .from(schema.auditLog)
    .where(and(eq(schema.auditLog.action, "directory.added"), eq(schema.auditLog.entityType, "directory_entry")))
    .orderBy(desc(schema.auditLog.id))
    .limit(50)
    .catch(() => []);
  const ids = log.map((l) => Number(l.id)).filter(Number.isFinite);
  const rows = ids.length ? await db.select().from(schema.directoryEntries).where(inArray(schema.directoryEntries.id, ids)).orderBy(desc(schema.directoryEntries.id)) : [];
  const { formatPhone } = await import("@/lib/phone");
  const added = rows.map((r) => ({ id: r.id, text: `${r.lastName}, ${r.firstName} | ${r.house} ${r.street}${r.unit ? `, unit ${r.unit}` : ""} | ${r.town}, ${r.state} ${r.zip}${r.phone ? ` | ${formatPhone(r.phone)}` : ""}` }));
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Link href="/admin/customers" className="text-sm font-bold text-navy">
        &larr; Customers
      </Link>
      <h1 className="text-2xl font-black sm:text-3xl">Directory list</h1>
      <p className="text-sm text-muted">
        The address lookup source for the phone line, kept apart from customer accounts. Upload a CSV with a header row and these columns, in this order: {DIRECTORY_COLUMNS.join(", ")}. A 7-digit phone number is saved as 845.
      </p>
      <p className="card p-3 text-sm" data-directory-count>
        Loaded now: <b>{now.rows}</b> rows, <b>{now.phones}</b> phone numbers, <b>{now.shared}</b> numbers shared by more than one entry. Owner only: never shown to Secretary or Delivery, never on the website.
      </p>
      <AddNameForm streets={[...STREETS.map((x) => x.name)].sort()} zips={ZIP_CODES.map((z) => ({ zip: z, town: townForZip(z) ?? "Monroe" }))} added={added} />
      <h2 className="pt-2 text-lg font-black">Replace the whole list</h2>
      <DirectoryPreviewForm />
    </div>
  );
}
