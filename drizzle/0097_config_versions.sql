-- Admin handoff Phase 2 (Nov 26, 2026): every Admin setting change as a version (draft, live, discarded), append-only
CREATE TABLE IF NOT EXISTS "config_versions" (
  "id" serial PRIMARY KEY NOT NULL,
  "key" text NOT NULL,
  "value" jsonb,
  "previous" jsonb,
  "status" text NOT NULL DEFAULT 'draft',
  "reason" text,
  "created_by" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "published_by" integer,
  "published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "config_versions_key_idx" ON "config_versions" ("key", "created_at");
