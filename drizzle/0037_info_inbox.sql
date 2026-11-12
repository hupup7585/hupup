-- Abraham (Nov 12, 2026): an Inbox in Admin for info@hupupattractions.com. Every email and reply is kept (nothing is
-- ever deleted). Mail arrives from a Cloudflare Email Worker (which still forwards to Gmail first) in pieces under
-- Vercel's 4.5 MB request limit; the full original email is kept too.
CREATE TABLE IF NOT EXISTS "inbox_raw" (
  "upload_id" text PRIMARY KEY,
  "parts" integer NOT NULL,
  "email_id" integer,
  "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inbox_raw_chunks" (
  "upload_id" text NOT NULL REFERENCES "inbox_raw"("upload_id"),
  "idx" integer NOT NULL,
  "data" bytea NOT NULL,
  PRIMARY KEY ("upload_id", "idx")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inbox_emails" (
  "id" serial PRIMARY KEY,
  "message_id" text UNIQUE,
  "upload_id" text,
  "from_address" text NOT NULL,
  "from_name" text,
  "to_address" text,
  "subject" text,
  "text_body" text,
  "html_body" text,
  "received_at" timestamptz NOT NULL DEFAULT now(),
  "read_at" timestamptz,
  "customer_id" integer REFERENCES "customers"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbox_emails_received_idx" ON "inbox_emails" ("received_at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inbox_files" (
  "id" serial PRIMARY KEY,
  "email_id" integer REFERENCES "inbox_emails"("id"),
  "reply_id" integer,
  "file_name" text NOT NULL,
  "content_type" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "complete" boolean NOT NULL DEFAULT false,
  "too_big" boolean NOT NULL DEFAULT false,
  "created_by" integer,
  "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inbox_file_chunks" (
  "file_id" integer NOT NULL REFERENCES "inbox_files"("id"),
  "idx" integer NOT NULL,
  "data" bytea NOT NULL,
  PRIMARY KEY ("file_id", "idx")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inbox_replies" (
  "id" serial PRIMARY KEY,
  "email_id" integer NOT NULL REFERENCES "inbox_emails"("id"),
  "to_address" text NOT NULL,
  "subject" text NOT NULL,
  "body" text NOT NULL,
  "sent" boolean NOT NULL DEFAULT false,
  "error" text,
  "user_id" integer,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
