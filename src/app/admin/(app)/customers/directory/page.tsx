import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { DIRECTORY_COLUMNS } from "@/lib/directory-list";
import DirectoryPreviewForm from "./DirectoryPreviewForm";

export const dynamic = "force-dynamic";

/** Owner only (Abraham, Nov 22, 2026): the community directory list for the phone address lookup. Separate from customers. */
export default async function DirectoryPage() {
  await requireOwner();
  const { directoryCount } = await import("@/lib/directory");
  const now = await directoryCount().catch(() => ({ rows: 0, phones: 0, shared: 0 }));
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
      <DirectoryPreviewForm />
    </div>
  );
}
