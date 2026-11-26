/**
 * Restore a Hup Up Attractions backup (the .json.gz from Admin > System status or the weekly email) into an EMPTY
 * database, for example a new Neon branch. Never overwrites or deletes: tables that already have rows are skipped.
 *
 *   DATABASE_URL=<the empty database> npx tsx scripts/restore-backup.ts hupup-backup-2026-11-26.json.gz
 *
 * Run the migrations on the empty database first (npm run db:migrate), then this script. Keys, passwords and sign-in
 * codes are not in backups: set them again by hand after the restore.
 */
import { readFileSync } from "node:fs";

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Usage: DATABASE_URL=... npx tsx scripts/restore-backup.ts <backup.json.gz>");
  const { restoreBackup } = await import("../src/lib/backup");
  const r = await restoreBackup(readFileSync(file));
  for (const [t, n] of Object.entries(r.restored)) console.log(`restored ${t}: ${n} rows`);
  for (const [t, why] of Object.entries(r.skipped)) console.log(`skipped ${t}: ${why}`);
  process.exit(Object.keys(r.skipped).some((t) => !/already has|no such table/.test(r.skipped[t])) ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
