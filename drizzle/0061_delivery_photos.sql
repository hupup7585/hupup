CREATE TABLE IF NOT EXISTS "delivery_photos" (
  "id" serial PRIMARY KEY NOT NULL,
  "order_id" integer NOT NULL,
  "stop" text NOT NULL,
  "storage_key" text NOT NULL,
  "content_type" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "taken_by" integer,
  "taken_by_name" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "delivery_photos_order_idx" ON "delivery_photos" ("order_id");
