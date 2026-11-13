-- Abraham (Nov 13, 2026): every phone line editable in Admin. An edit is saved as a draft "Waiting for approval"; the
-- live wording keeps playing until he approves it. Every version is kept with its date, and any can be restored.
CREATE TABLE IF NOT EXISTS "prompt_versions" (
  "id" serial PRIMARY KEY,
  "prompt_key" text NOT NULL,
  "text" text NOT NULL,
  "status" text NOT NULL,
  "note" text,
  "created_by" integer,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "approved_by" integer,
  "approved_at" timestamptz
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prompt_versions_key_idx" ON "prompt_versions" ("prompt_key", "created_at");
