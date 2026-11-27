/*
 * The free timer (Abraham, Nov 27, 2026, 2:14 AM, option B): the free Cloudflare scheduler Worker calls
 * /api/cron/frequent every 5 minutes (no account, no card; it is put on Cloudflare by every live build). To keep the
 * Neon free plan asleep, each kind of waiting work leaves a tiny file on our free Cloudflare storage (R2) saying when
 * it is next due; the site reads that file (not the database) and wakes the database only when something is due.
 * Kinds: "address-rechecks" (address re-checks) and "held-texts" (offer texts held for quiet hours, Shabbes or
 * Yom Tov, and staff alert texts held for Shabbes or Yom Tov). Without R2 the 3-hourly run still does everything.
 */
export type WakeKind = "address-rechecks" | "held-texts";
const keyOf = (k: WakeKind) => `flags/${k}.json`;

/** Set when the next piece of this work is due (null = nothing waiting). `earliest` keeps an earlier time already set. */
export async function armWake(kind: WakeKind, at: Date | null, opts: { earliest?: boolean } = {}) {
  const { r2Ready, r2Put, r2Delete } = await import("@/lib/r2");
  if (!r2Ready()) return;
  try {
    if (!at) return void (await r2Delete(keyOf(kind)));
    if (opts.earliest) {
      const now = await wakeAt(kind);
      if (now && now.getTime() <= at.getTime()) return;
    }
    await r2Put(keyOf(kind), new TextEncoder().encode(JSON.stringify({ nextAt: at.toISOString() })), "application/json");
  } catch {
    // the 3-hourly run is the safety net
  }
}

export async function wakeAt(kind: WakeKind): Promise<Date | null> {
  const { r2Ready, r2Get } = await import("@/lib/r2");
  if (!r2Ready()) return null;
  try {
    const r = await r2Get(keyOf(kind));
    if (!r.ok) return null;
    const j = (await r.json()) as { nextAt?: string };
    return j.nextAt ? new Date(j.nextAt) : null;
  } catch {
    return null;
  }
}

/** Is this work due now? Reads the small file only (no database). */
export async function wakeDue(kind: WakeKind, now = new Date()): Promise<boolean> {
  const at = await wakeAt(kind);
  return Boolean(at && at.getTime() <= now.getTime());
}
