-- Sola retry fix (Abraham, Nov 23, 2026): when the call to Sola joined the waiting caller
ALTER TABLE "phonepay_attempts" ADD COLUMN IF NOT EXISTS "bridged_at" timestamp with time zone;
