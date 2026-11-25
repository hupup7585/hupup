-- Payment connect timing (Abraham, Nov 25, 2026): when the hold line started and ended in the pay queue
ALTER TABLE "phonepay_attempts" ADD COLUMN IF NOT EXISTS "hold_started_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "phonepay_attempts" ADD COLUMN IF NOT EXISTS "hold_done_at" timestamp with time zone;
