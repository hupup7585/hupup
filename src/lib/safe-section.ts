/**
 * One dashboard section must never take down the whole page (Abraham, after the call_events outage): if a section's
 * query fails, that section shows "Not active yet: <reason>" and the rest of the page loads.
 */
export type Section<T> = { ok: true; value: T } | { ok: false; reason: string };

export function sectionReason(e: unknown): string {
  const msg = String((e as { cause?: { message?: string } })?.cause?.message ?? (e as Error)?.message ?? e);
  const table = msg.match(/relation "([a-z_]+)" does not exist/)?.[1];
  return table ? `the ${table} table isn't in the database yet (a database update hasn't run)` : "this section couldn't load right now";
}

export async function safeSection<T>(name: string, p: Promise<T>): Promise<Section<T>> {
  try {
    return { ok: true, value: await p };
  } catch (e) {
    console.error(`[dashboard] ${name} failed:`, e);
    return { ok: false, reason: sectionReason(e) };
  }
}
