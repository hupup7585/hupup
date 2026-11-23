-- Directory list as a sheet (Abraham, Nov 23, 2026): two Yiddish name columns (Hebrew letters) and a row order
ALTER TABLE "directory_entries" ADD COLUMN IF NOT EXISTS "yiddish_last_name" text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE "directory_entries" ADD COLUMN IF NOT EXISTS "yiddish_first_name" text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE "directory_entries" ADD COLUMN IF NOT EXISTS "sort_order" double precision;
--> statement-breakpoint
UPDATE "directory_entries" SET "sort_order" = "id" WHERE "sort_order" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "directory_entries_sort_idx" ON "directory_entries" ("sort_order");
