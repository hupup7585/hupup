import { sql } from "drizzle-orm";

type Exec = { execute: (q: ReturnType<typeof sql>) => Promise<{ rows: unknown[] }> };

/**
 * Lock everything a booking of these items can share stock with, in ONE statement, in product id order (extra check K2,
 * deep check 06:00 M48): the items themselves, every item of their stock groups (the maze), and, when any of them is
 * laser tag, every laser item (the shared gun packs).
 *
 * Before, each path took these locks in its own order (group first, then laser items, then the product; or only the
 * group and the product), so a maze booking and a gun-pack booking at the same moment could wait on each other
 * (deadlock: one booking failed with a database error), and the pay link and Admin paths never locked the gun packs.
 * One sorted statement means every path takes the same rows in the same order. Locking a row already held is free, so
 * paths that lock again later (reserveInTx per item) keep working.
 */
export async function lockStock(tx: Exec, productIds: number[]): Promise<number[]> {
  const asked = [...new Set(productIds.filter((n) => Number.isInteger(n) && n > 0))];
  if (!asked.length) return [];
  // Extra check (09:00 P12): the laser gun pools as availability counts them (Catalog > Item types once the Owner sets
  // them, else the names), so a laser item outside a "laser" category is locked too; the category-name rule below stays
  const { laserPoolInfo } = await import("@/lib/availability");
  const pools = await laserPoolInfo(tx as never);
  const ids = asked.some((i) => pools.items.has(i)) ? [...new Set([...asked, ...pools.items.keys()])] : asked;
  const list = sql.join(
    ids.map((i) => sql`${i}`),
    sql`, `,
  );
  const r = await tx.execute(sql`
    SELECT p.id FROM products p LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.id IN (${list})
       OR (p.stock_group IS NOT NULL AND p.stock_group IN (SELECT stock_group FROM products WHERE id IN (${list}) AND stock_group IS NOT NULL))
       OR (c.name ~* 'laser' AND EXISTS (SELECT 1 FROM products q JOIN categories qc ON qc.id = q.category_id WHERE q.id IN (${list}) AND qc.name ~* 'laser'))
    ORDER BY p.id
    FOR UPDATE OF p`);
  return (r.rows as { id: number }[]).map((x) => Number(x.id));
}
