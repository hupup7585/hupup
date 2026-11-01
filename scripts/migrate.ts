import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

/** Applies pending migrations. Safe to run on every deploy (already-applied migrations are skipped). */
async function main() {
  // Neon: use the direct (unpooled) connection for schema changes when available.
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) {
    console.log("No DATABASE_URL set - skipping migrations.");
    return;
  }
  const pool = new Pool({ connectionString: url, max: 1 });
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  console.log("Migrations applied.");
  await pool.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
