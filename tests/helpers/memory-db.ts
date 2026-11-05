import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/lib/db/schema";

/**
 * A throwaway Postgres that lives only in this test process's memory (PGlite), with every migration in ./drizzle
 * applied. It never connects to the shared/live database or the local Postgres server.
 */
export async function createMemoryDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  return { client, db, schema };
}
