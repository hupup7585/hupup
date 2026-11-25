/**
 * Batch 4 item 2 (Abraham, Nov 25, 2026): URLs and search use the order number people see (1031), not the database
 * id (31). Order numbers are always 1000 + id; an older link with the plain id (1000 or less) still works.
 */
export function orderIdFromParam(param: string | number | null | undefined): number {
  const n = Number(String(param ?? "").replace(/[^\d]/g, ""));
  if (!Number.isInteger(n) || n <= 0) return 0;
  return n > 1000 ? n - 1000 : n;
}

/** The Admin page of an order, by its order number. */
export function orderPath(id: number | string): string {
  return `/admin/orders/${1000 + Number(id)}`;
}
