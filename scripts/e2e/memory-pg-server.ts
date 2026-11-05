/**
 * E2E test helper: an in-memory Postgres (PGlite) served on a local socket, so the real app can run against it.
 * Applies every migration in ./drizzle and the standard seed. Nothing here touches a real database.
 * Usage: tsx scripts/e2e/memory-pg-server.ts [port]
 */
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

async function main() {
  const port = Number(process.argv[2] || 54329);
  const pg = new PGlite();
  await migrate(drizzle(pg), { migrationsFolder: "./drizzle" });
  const server = new PGLiteSocketServer({ db: pg, port, host: "127.0.0.1" });
  await server.start();
  console.log(`memory-pg ready on 127.0.0.1:${port}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
