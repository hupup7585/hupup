-- Possible duplicate customers (Abraham, Nov 27, 2026, 2:14 AM): a merged record is kept (never deleted) and points to
-- the record that was kept. Additive only.
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "merged_into_id" integer;
