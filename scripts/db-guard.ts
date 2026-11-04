/**
 * Preview deployments share the production database (the Neon DATABASE_URL targets both
 * Preview and Production in Vercel). Schema/data changes must reach that database only from
 * production builds, i.e. after Abram approves a merge into the live branch.
 *
 * Returns a reason string when this build must NOT touch the database, otherwise null.
 * Set ALLOW_PREVIEW_DB_WRITES=1 only if a preview gets its own separate database branch.
 */
export function dbWriteSkipReason(env: Record<string, string | undefined> = process.env): string | null {
  if (env.VERCEL_ENV === "preview" && env.ALLOW_PREVIEW_DB_WRITES !== "1") {
    return "Vercel preview build: skipping database changes (previews share the live database; they run after the merge to production).";
  }
  return null;
}
