-- Abraham, Nov 17-18, 2026: a discount for a specific customer (by phone number), dollars or percent, before tax;
-- stays on every booking until the Owner turns it off, with an optional end date; never combined with an offer
CREATE TABLE IF NOT EXISTS "customer_discounts" (
  "id" serial PRIMARY KEY,
  "phone" text NOT NULL,
  "kind" text NOT NULL,
  "amount_cents" integer,
  "percent" numeric(5,2),
  "ends_on" date,
  "note" text NOT NULL DEFAULT '',
  "active" boolean NOT NULL DEFAULT true,
  "created_by" integer,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "turned_off_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_discounts_phone_idx" ON "customer_discounts" ("phone");
