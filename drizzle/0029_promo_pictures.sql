-- Abraham (all-in-one, section 7): two pictures per promo text, longer promo texts, optional Rentals page link.
-- Pictures are stored in the database (no new paid service): the phone-ready JPG plus the full-size original.
CREATE TABLE IF NOT EXISTS "promo_pictures" (
  "id" serial PRIMARY KEY,
  "token" text NOT NULL UNIQUE,
  "source" text NOT NULL,
  "product_id" integer,
  "file_name" text,
  "jpg" bytea NOT NULL,
  "jpg_bytes" integer NOT NULL,
  "width" integer,
  "height" integer,
  "original_type" text,
  "original_bytes" integer,
  "original_complete" boolean NOT NULL DEFAULT false,
  "created_by" integer,
  "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "promo_picture_chunks" (
  "picture_id" integer NOT NULL REFERENCES "promo_pictures"("id"),
  "idx" integer NOT NULL,
  "data" bytea NOT NULL,
  PRIMARY KEY ("picture_id", "idx")
);--> statement-breakpoint
ALTER TABLE "sms_campaigns" ADD COLUMN IF NOT EXISTS "picture_ids" jsonb NOT NULL DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "sms_campaigns" ADD COLUMN IF NOT EXISTS "rentals_link" boolean NOT NULL DEFAULT false;
