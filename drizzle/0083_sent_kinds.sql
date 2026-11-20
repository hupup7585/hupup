-- Abraham, Nov 20, 2026: Sent holds only emails people wrote; sign-in codes, catalogs we sent and automatic emails
-- get their own folders. Every sign-in is kept with its sign-out time.
ALTER TABLE "inbox_replies" ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'sent';
--> statement-breakpoint
UPDATE "inbox_replies" SET "kind" = CASE
  WHEN "subject" ~* 'sign-in code' THEN 'code'
  WHEN "user_id" IS NULL AND "email_id" IS NULL AND "subject" ~* 'catalog' THEN 'catalog'
  WHEN "user_id" IS NULL AND "email_id" IS NULL THEN 'auto'
  ELSE 'sent' END;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbox_replies_kind_idx" ON "inbox_replies" ("kind", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sign_ins" (
  "id" serial PRIMARY KEY,
  "user_id" integer,
  "method" text NOT NULL,
  "token_hash" text NOT NULL UNIQUE,
  "user_agent" text,
  "signed_in_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  "signed_out_at" timestamptz,
  "end_reason" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sign_ins_time_idx" ON "sign_ins" ("signed_in_at");
