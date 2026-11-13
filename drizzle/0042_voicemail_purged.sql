ALTER TABLE "voicemails" ADD COLUMN IF NOT EXISTS "purged_at" timestamp with time zone;
