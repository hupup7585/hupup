-- The community directory (Abraham, Nov 23, 2026): phone address lookup source, Owner only
CREATE TABLE IF NOT EXISTS "directory_entries" (
  "id" serial PRIMARY KEY,
  "last_name" text NOT NULL,
  "first_name" text NOT NULL DEFAULT '',
  "house" text NOT NULL,
  "street" text NOT NULL,
  "unit" text,
  "town" text NOT NULL,
  "state" text NOT NULL DEFAULT 'NY',
  "zip" text NOT NULL,
  "phone" text,
  "area_printed" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "directory_entries_phone_idx" ON "directory_entries" ("phone");
