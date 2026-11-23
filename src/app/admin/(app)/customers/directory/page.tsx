import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { DIRECTORY_COLUMNS_YIDDISH } from "@/lib/directory-list";
import DirectoryPreviewForm from "./DirectoryPreviewForm";
import DirectorySheet from "./DirectorySheet";
import LookupBox from "./LookupBox";

export const dynamic = "force-dynamic";

/** The steps in the How to use box (Abraham, Nov 23, 2026): plain English, one list per action. */
const HOW_TO: { title: string; steps: string[] }[] = [
  { title: "Edit a cell", steps: ["Click the cell once to pick it (a blue frame shows).", "Start typing, or click it again, or press Enter.", "Type the new value.", "Press Enter to save. The list shows a green \"Saved\". To cancel instead, press Esc."] },
  { title: "Add a row at the end", steps: ["Click \"+ Add a row at the end\" above the list.", "A new empty row appears at the bottom, with its Last name cell picked.", "Type each value and press Tab to move to the next cell. Every cell saves by itself."] },
  { title: "Insert a row above or below", steps: ["Point at the row number on the left of the row.", "Click the three dots that show next to the number.", "Click \"Insert a row above\" or \"Insert a row below\".", "Fill in the new empty row the same way as editing a cell. (When the list is sorted, turn the sort off first.)"] },
  { title: "Delete a row and undo", steps: ["Point at the row number and click the three dots.", "Click \"Delete this row\". The row is removed right away.", "To bring it back, click \"Undo\" above the list (or press Ctrl+Z). Undo also takes back the last cell change."] },
  { title: "Copy and paste", steps: ["Pick one cell, or hold Shift and click another cell to pick a block. To pick a whole row, click its row number.", "Press Ctrl+C (Cmd+C on a Mac) to copy.", "Click the cell where the paste should start.", "Press Ctrl+V (Cmd+V on a Mac). The values fill to the right and down, and each row saves. Rows from Excel or Google Sheets paste the same way."] },
  { title: "Search", steps: ["Type in the \"Search every column\" box above the list.", "Only rows with that text in any column stay on screen.", "To see everything again, clear the box, or click \"Clear search, filter and sort\"."] },
  { title: "Sort", steps: ["Click a column name in the dark header row. The list sorts A to Z, and a yellow arrow shows.", "Click the same name again for Z to A.", "Click it a third time to go back to the list's own order."] },
  { title: "Filter", steps: ["Click \"Filter\" above the list. A row of small boxes opens under the column names.", "Type in the box of any column, for example a street name.", "Only rows that contain that text in that column stay. Filters in several columns work together.", "Click \"Clear search, filter and sort\" to see the whole list again."] },
  { title: "Download", steps: ["Click \"Download\" above the list.", "Click \"Excel file (.xlsx)\" or \"CSV file (.csv)\".", "The whole list downloads with all ten columns. The Yiddish letters stay as they are in both files."] },
  { title: "Load a whole new list", steps: ["Scroll down to \"Replace the whole list\".", "Click \"Choose File\" and pick the CSV file. It may start with the two Yiddish columns, or begin with the last name as before.", "Click \"Check the file\" and look over the counts and the first rows.", "Click \"Load this list\" and confirm. This replaces every row in the directory."] },
];

/** Owner only (Abraham, Nov 22-23, 2026): the community directory, as a sheet, for the phone address lookup. */
export default async function DirectoryPage() {
  await requireOwner();
  const { directoryCount } = await import("@/lib/directory");
  const now = await directoryCount().catch(() => ({ rows: 0, phones: 0, shared: 0 }));
  const { STREETS } = await import("@/lib/streets");
  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <div>
        <Link href="/admin/customers" className="text-sm font-bold text-navy">
          &larr; Customers
        </Link>
        <h1 className="text-2xl font-black sm:text-3xl">Directory list</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">The address lookup source for the phone line, kept apart from customer accounts. Owner only: never shown to Secretary or Delivery, never on the website.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3" data-directory-count>
        {[
          ["Rows", now.rows],
          ["Phone numbers", now.phones],
          ["Shared numbers", now.shared],
        ].map(([label, n]) => (
          <div key={label} className="rounded-2xl border border-[#D9E3F0] bg-gradient-to-br from-white to-[#F3F7FC] px-5 py-4 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-wider text-[#6B7C93]">{label}</div>
            <div className="text-3xl font-black tabular-nums text-[#123D73]">{Number(n).toLocaleString()}</div>
          </div>
        ))}
      </div>

      <details className="group rounded-2xl border border-[#D9E3F0] bg-white text-[#1B2B41] shadow-sm" data-how-to>
        <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4">
          <span className="text-lg font-black text-[#123D73]">How to use</span>
          <span className="text-sm font-bold text-[#2585D8] group-open:hidden">Show the steps</span>
          <span className="hidden text-sm font-bold text-[#2585D8] group-open:inline">Hide the steps</span>
        </summary>
        <div className="grid gap-4 border-t border-[#E6EDF6] bg-white px-5 py-5 md:grid-cols-2">
          {HOW_TO.map((h) => (
            <div key={h.title}>
              <h3 className="mb-1 font-black text-[#123D73]">{h.title}</h3>
              <ol className="ml-5 list-decimal space-y-1 text-sm leading-relaxed text-[#1B2B41]">
                {h.steps.map((s) => <li key={s}>{s}</li>)}
              </ol>
            </div>
          ))}
        </div>
      </details>

      <DirectorySheet streets={[...STREETS.map((s) => s.name)].sort()} />

      <LookupBox />

      <div className="space-y-2 pt-2">
        <h2 className="text-lg font-black">Replace the whole list</h2>
        <p className="text-sm text-muted">
          A CSV file with a header row, in one of two layouts. With Yiddish names: {DIRECTORY_COLUMNS_YIDDISH.join(", ")}. Or without them, starting with the last name, as before. A 7-digit phone number is saved as 845.
        </p>
        <DirectoryPreviewForm />
      </div>
    </div>
  );
}
