import { gzipSync } from "node:zlib";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

/**
 * Full backup of the business data (plan step 3, Abraham, Nov 15, 2026), free: a download in Admin > System status
 * any time, and a weekly copy by email to the Owner. Left out on purpose: keys, passwords, sign-in codes, sessions and
 * their hashes, and raw email pieces (the emails themselves are in). Card numbers are never stored anywhere.
 */
export const SKIP_TABLES = new Set(["api_keys", "api_keys_log", "api_keys_unlocks", "admin_sessions", "login_codes", "inbox_raw", "inbox_raw_chunks", "inbox_file_chunks", "__drizzle_migrations"]);
const SECRET_COLUMN = /(hash|token|secret|_enc$|password|pin$)/i;

export async function buildBackup(now = new Date()) {
  const tables = (await db.execute(sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`)).rows.map((r) => String((r as { table_name: string }).table_name));
  const data: Record<string, unknown[]> = {};
  for (const t of tables) {
    if (SKIP_TABLES.has(t)) continue;
    const rows = (await db.execute(sql.raw(`SELECT * FROM "${t.replace(/"/g, "")}"`))).rows as Record<string, unknown>[];
    data[t] = rows.map((r) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r)) out[k] = SECRET_COLUMN.test(k) ? undefined : Buffer.isBuffer(v) || v instanceof Uint8Array ? "(file content left out)" : v;
      return out;
    });
  }
  const json = JSON.stringify({ business: "Hup Up Attractions", madeAt: now.toISOString(), tables: data });
  return { gz: gzipSync(json), tables: Object.keys(data).length, rows: Object.values(data).reduce((n, r) => n + r.length, 0) };
}

export const backupFileName = (now = new Date()) => `hupup-backup-${now.toISOString().slice(0, 10)}.json.gz`;

/**
 * Restore a backup made by buildBackup into an EMPTY database (gap review, Nov 26, 2026): never overwrites or deletes
 * anything. A table that already has rows is skipped and reported. Tables are filled in as many passes as their links
 * need (an order after its customer); each table's id counter is moved past the highest id restored. Left-out columns
 * (keys, passwords, codes) come back empty and must be set again by hand.
 */
export async function restoreBackup(gz: Buffer | Uint8Array, exec: { execute: typeof db.execute } = db) {
  const { gunzipSync } = await import("node:zlib");
  const parsed = JSON.parse(gunzipSync(Buffer.from(gz)).toString("utf8")) as { tables: Record<string, Record<string, unknown>[]> };
  const restored: Record<string, number> = {};
  const skipped: Record<string, string> = {};
  const exists = new Set((await exec.execute(sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`)).rows.map((r) => String((r as { table_name: string }).table_name)));
  let pending = Object.keys(parsed.tables).filter((t) => {
    if (!exists.has(t)) return (skipped[t] = "no such table here"), false;
    return true;
  });
  for (const t of [...pending]) {
    const n = Number(((await exec.execute(sql.raw(`SELECT count(*)::int AS n FROM "${t.replace(/"/g, "")}"`))).rows[0] as { n: number }).n);
    if (n > 0) {
      skipped[t] = `already has ${n} rows (nothing changed)`;
      pending = pending.filter((x) => x !== t);
    }
  }
  for (let pass = 0; pending.length && pass < 20; pass++) {
    const failed: string[] = [];
    for (const t of pending) {
      const rows = parsed.tables[t];
      const name = t.replace(/"/g, "");
      try {
        if (rows.length) {
          await exec.execute(sql`INSERT INTO ${sql.raw(`"${name}"`)} SELECT * FROM json_populate_recordset(NULL::${sql.raw(`"${name}"`)}, ${JSON.stringify(rows)}::json)`);
          const hasId = rows.some((r) => typeof r.id === "number");
          if (hasId) await exec.execute(sql.raw(`SELECT setval(pg_get_serial_sequence('"${name}"', 'id'), (SELECT max(id) FROM "${name}"))`)).catch(() => null);
        }
        restored[t] = rows.length;
      } catch (e) {
        failed.push(t);
        skipped[t] = (e as Error).message.slice(0, 200);
      }
    }
    if (failed.length === pending.length) break; // no progress: report what could not be restored
    for (const t of pending) if (!failed.includes(t)) delete skipped[t];
    pending = failed;
  }
  return { restored, skipped };
}
