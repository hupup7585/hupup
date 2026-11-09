-- Seasonal promo campaigns (Abraham, Nov 9, 2026). Nothing is ever deleted: campaigns are canceled, not removed.
CREATE TABLE IF NOT EXISTS "sms_campaigns" (
  "id" serial PRIMARY KEY,
  "name" text NOT NULL,
  "body" text NOT NULL,
  -- draft (being written) | approved (Owner OK'd the wording; Secretary may send) | sent | canceled
  "status" text NOT NULL DEFAULT 'draft',
  "created_by" integer,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "approved_by" integer,
  "approved_at" timestamptz,
  "sent_by" integer,
  "sent_at" timestamptz,
  "eligible_count" integer,
  "sent_count" integer,
  "held_count" integer,
  "skipped_count" integer
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sms_campaign_sends" (
  "id" serial PRIMARY KEY,
  "campaign_id" integer NOT NULL REFERENCES "sms_campaigns"("id"),
  "customer_id" integer NOT NULL,
  "phone" text NOT NULL,
  "message_id" integer,
  -- sent | held (quiet hours, goes out in the next window) | skipped (with reason)
  "status" text NOT NULL,
  "reason" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sms_campaign_sends_once" ON "sms_campaign_sends" ("campaign_id", "customer_id");
