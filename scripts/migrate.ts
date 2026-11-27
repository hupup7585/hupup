import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { dbWriteSkipReason } from "./db-guard";
import { explicitSslMode } from "../src/lib/db";

/** Applies pending migrations. Safe to run on every deploy (already-applied migrations are skipped). */
async function main() {
  const skip = dbWriteSkipReason();
  if (skip) {
    console.log(skip);
    return;
  }
  // Neon: use the direct (unpooled) connection for schema changes when available.
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) {
    console.log("No DATABASE_URL set - skipping migrations.");
    return;
  }
  const pool = new Pool({ connectionString: explicitSslMode(url), max: 1 });
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  console.log("Migrations applied.");
  await reportSkipped(pool);
  await pool.end();
}
/**
 * Deep check Nov 27, 2026 (item 21): the migrator only runs a migration dated later than the last one it ran, so one
 * dated too early is skipped without a word (the Nov 9 outage). This lists any migration in the journal that the live
 * database never recorded. It only warns (0016 is known: 0023 restored its table), so a deploy is never stopped by it.
 * A new migration's "when" in drizzle/meta/_journal.json must be later than every earlier one (tests/migrations-order).
 */
async function reportSkipped(pool: Pool) {
  try {
    const { createHash } = await import("node:crypto");
    const { readFileSync } = await import("node:fs");
    const journal = JSON.parse(readFileSync("./drizzle/meta/_journal.json", "utf8")).entries as { tag: string }[];
    const done = new Set((await pool.query(`SELECT hash FROM drizzle.__drizzle_migrations`)).rows.map((r: { hash: string }) => r.hash));
    const missing = journal.filter((e) => e.tag !== "0016_call_events" && !done.has(createHash("sha256").update(readFileSync(`./drizzle/${e.tag}.sql`).toString()).digest("hex")));
    if (missing.length) {
      const tags = missing.map((e) => e.tag).join(", ");
      console.warn(`WARNING: database updates never applied (dated too early?): ${tags}`);
      // Deep check 06:00 M67: a build-log warning is read by nobody. The Owner is emailed (staff-only alert, in the
      // activity log) once for each new list of skipped updates, never on every build.
      const last = (await pool.query(`SELECT after->>'tags' AS tags FROM audit_log WHERE action = 'deploy.migrations_skipped' ORDER BY id DESC LIMIT 1`)).rows[0] as { tags?: string } | undefined;
      if (last?.tags !== tags) {
        await pool.query(`INSERT INTO audit_log (action, entity_type, entity_id, after) VALUES ('deploy.migrations_skipped', 'system', '0', $1)`, [JSON.stringify({ tags })]);
        const { alertOwner } = await import("../src/lib/ops-alerts");
        await alertOwner("database updates were skipped by a deploy", `These database updates are in the code but were never applied to the live database: ${tags}.\n\nThe site may be missing a table or column they add. A developer needs to apply them (they are additive) or give them a later date in drizzle/meta/_journal.json.`).catch(() => false);
      }
    }
  } catch (e) {
    console.warn("Could not check for skipped database updates:", (e as Error).message);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
