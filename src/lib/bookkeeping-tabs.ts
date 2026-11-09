/** Bookkeeping screens, in the side menu under BOOKKEEPING, sorted into small groups (Abraham, Nov 9, 2026). */
export const BOOK_GROUPS: { label: string; tabs: [string, string][] }[] = [
  { label: "Money in", tabs: [["overview", "Overview"], ["income", "Income"], ["invoices", "Invoices"]] },
  { label: "Money out", tabs: [["expenses", "Expenses"], ["bills", "Bills I owe"], ["processor", "Sola fees"]] },
  { label: "Bank and tax", tabs: [["bank", "Bank & card"], ["tax", "Sales tax"]] },
  { label: "Business", tabs: [["equipment", "Equipment"], ["people", "Staff & 1099"], ["mileage", "Mileage"]] },
  { label: "Records", tabs: [["reports", "Reports"], ["ledger", "All entries"], ["gl", "General ledger"], ["settings", "Settings"]] },
];

export const BOOK_TABS: [string, string][] = BOOK_GROUPS.flatMap((g) => g.tabs);

export const bookTabHref = (tab: string) => `/admin/bookkeeping?tab=${tab}`;

/** The page name for a tab (the big title on each Bookkeeping page). */
export const bookTabLabel = (tab: string) => BOOK_TABS.find(([k]) => k === tab)?.[1] ?? "Overview";
