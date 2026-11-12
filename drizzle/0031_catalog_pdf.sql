-- Abraham (Phone Menu v3, section 9): his catalog PDF, uploaded and replaced in Admin, sent with catalog emails.
-- Stored in the database (no new paid service), in pieces (Vercel takes at most 4.5 MB per request). Old files kept.
CREATE TABLE IF NOT EXISTS "catalog_files" (
  "id" serial PRIMARY KEY,
  "file_name" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "complete" boolean NOT NULL DEFAULT false,
  "current" boolean NOT NULL DEFAULT false,
  "uploaded_by" integer,
  "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "catalog_file_chunks" (
  "file_id" integer NOT NULL REFERENCES "catalog_files"("id"),
  "idx" integer NOT NULL,
  "data" bytea NOT NULL,
  PRIMARY KEY ("file_id", "idx")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "catalog_email_requests" (
  "id" serial PRIMARY KEY,
  "sender" text NOT NULL,
  "subject" text,
  "replied" boolean NOT NULL DEFAULT false,
  "reason" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
