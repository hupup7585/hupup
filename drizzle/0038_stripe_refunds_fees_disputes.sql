-- Abraham (Nov 12, 2026): Stripe refunds from Admin, Stripe fees and payouts in the books, and disputes.
-- Nothing is ever deleted.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "refunded_cents" integer NOT NULL DEFAULT 0;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "order_refunds" (
  "id" serial PRIMARY KEY,
  "order_id" integer NOT NULL REFERENCES "orders"("id"),
  "amount_cents" integer NOT NULL,
  "stripe_refund_id" text UNIQUE,
  "status" text NOT NULL,
  "error" text,
  "source" text NOT NULL DEFAULT 'admin',
  "user_id" integer,
  "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "order_disputes" (
  "id" serial PRIMARY KEY,
  "stripe_dispute_id" text NOT NULL UNIQUE,
  "order_id" integer REFERENCES "orders"("id"),
  "amount_cents" integer NOT NULL,
  "reason" text,
  "status" text NOT NULL,
  "evidence_due_by" timestamptz,
  "evidence_sent_at" timestamptz,
  "evidence_sent_by" integer,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stripe_balance_lines" (
  "id" text PRIMARY KEY,
  "type" text NOT NULL,
  "amount_cents" integer NOT NULL,
  "fee_cents" integer NOT NULL DEFAULT 0,
  "net_cents" integer NOT NULL,
  "description" text,
  "source_id" text,
  "order_id" integer,
  "payout_id" text,
  "happened_at" timestamptz NOT NULL,
  "available_on" timestamptz,
  "synced_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stripe_payouts" (
  "id" text PRIMARY KEY,
  "amount_cents" integer NOT NULL,
  "status" text NOT NULL,
  "arrival_date" timestamptz,
  "created_at" timestamptz NOT NULL,
  "synced_at" timestamptz NOT NULL DEFAULT now()
);
