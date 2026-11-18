-- Abraham, Nov 18, 2026 (Sola hang-up helper, option a): when the helper hung up the call to Sola
ALTER TABLE "phonepay_attempts" ADD COLUMN IF NOT EXISTS "helper_ended_at" timestamp with time zone;
