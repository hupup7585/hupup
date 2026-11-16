-- Files sent and received with texts (Abraham, Nov 16, 2026): stored in Cloudflare R2, only the key here
CREATE TABLE IF NOT EXISTS "message_files" (
  "id" serial PRIMARY KEY NOT NULL,
  "message_id" integer,
  "direction" text NOT NULL,
  "contact_phone" text NOT NULL,
  "customer_id" integer,
  "order_id" integer,
  "storage_key" text NOT NULL,
  "content_type" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "file_name" text,
  "source_url" text,
  "user_id" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_files_message_idx" ON "message_files" ("message_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_files_customer_idx" ON "message_files" ("customer_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_files_order_idx" ON "message_files" ("order_id");
