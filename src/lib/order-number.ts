/** The order number customers hear on the phone and see in Admin, texts, emails and receipts (one place, no database). */
export function orderNumber(id: number): string {
  return String(1000 + id);
}
