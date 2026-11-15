import { Search } from "lucide-react";

/** The Gmail-style search bar on the dashboard and the search page: searches orders, customers, emails, voicemails and calls. */
export default function SearchBar({ q = "" }: { q?: string }) {
  return (
    <form action="/admin/search" role="search" className="mb-5 flex items-center gap-2 rounded-full border border-line bg-white px-4 py-1.5 shadow-sm focus-within:shadow-md" data-search-bar>
      <Search className="h-5 w-5 shrink-0 text-muted" aria-hidden />
      <input name="q" defaultValue={q} className="min-w-0 flex-1 bg-transparent py-2 text-[15px] outline-none" placeholder="Search orders, customers, emails, voicemails and calls" aria-label="Search everything" />
      <button className="rounded-full bg-sky px-4 py-1.5 text-sm font-bold text-white">Search</button>
    </form>
  );
}
