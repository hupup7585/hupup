-- Custom-amount services on any order (Abraham, Nov 26, 2026). Additive only: a new table and three new columns
-- that start at 0, so every existing order and book entry keeps exactly the amounts it has.
CREATE TABLE IF NOT EXISTS "order_services" (
  "id" serial PRIMARY KEY NOT NULL,
  "order_id" integer NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "amount_cents" integer NOT NULL,
  "note" text,
  "show_note_on_receipt" boolean DEFAULT false NOT NULL,
  "taxable" boolean DEFAULT true NOT NULL,
  "locked_at" timestamp with time zone,
  "created_by" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "order_services_amount_positive" CHECK ("amount_cents" > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_services_order_idx" ON "order_services" ("order_id");
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "services_cents" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "services_tax_cents" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "book_entries" ADD COLUMN IF NOT EXISTS "services_cents" integer DEFAULT 0 NOT NULL;
