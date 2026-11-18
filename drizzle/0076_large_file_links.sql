-- Abraham, Nov 18, 2026: a file over 18 MB (up to 100 MB) is kept in R2 and sent as a 30-day download link
ALTER TABLE "inbox_files" ADD COLUMN IF NOT EXISTS "in_r2" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "inbox_files" ADD COLUMN IF NOT EXISTS "received_bytes" integer NOT NULL DEFAULT 0;
