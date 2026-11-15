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
