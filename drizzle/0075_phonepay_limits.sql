-- Abraham, Nov 17, 2026 (Missing Items, item 5): the caller's phone on each card try, and numbers blocked from card
-- payment by phone after too many declines (the secretary can unlock them in Admin)
ALTER TABLE "phonepay_attempts" ADD COLUMN IF NOT EXISTS "caller_phone" text;
--> statement-breakpoint
ALTER TABLE "phonepay_attempts" ADD COLUMN IF NOT EXISTS "sola_seen" text;
--> statement-breakpoint
ALTER TABLE "phonepay_attempts" ADD COLUMN IF NOT EXISTS "unclear_refs" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "phonepay_blocks" (
  "id" serial PRIMARY KEY,
  "phone" text NOT NULL,
  "blocked_at" timestamp with time zone NOT NULL DEFAULT now(),
  "declines" integer NOT NULL DEFAULT 0,
  "unlocked_at" timestamp with time zone,
  "unlocked_by" integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "phonepay_blocks_phone_idx" ON "phonepay_blocks" ("phone");
