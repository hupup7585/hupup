-- Address check with two backups (Abraham, Nov 27, 2026, 2:02-2:12 AM ET): one row per order whose house could not be
-- confirmed on the map at booking time, or whose re-check found a problem. Additive only.
CREATE TABLE IF NOT EXISTS "address_checks" (
  "order_id" integer PRIMARY KEY REFERENCES "orders"("id"),
  "address" text NOT NULL,
  "status" text NOT NULL DEFAULT 'unconfirmed',
  "problem_kind" text,
  "problem" text,
  "source" text,
  "paid_kind" text,
  "paid_zone" text,
  "tries" integer NOT NULL DEFAULT 0,
  "first_at" timestamp with time zone NOT NULL DEFAULT now(),
  "last_at" timestamp with time zone,
  "next_at" timestamp with time zone NOT NULL DEFAULT now(),
  "alerts" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "address_checks_next_idx" ON "address_checks" ("status", "next_at");--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "address_source" text;
