-- Box 34 (Abraham, Nov 21/24, 2026): delivery instructions are a recorded message saved with its booking
ALTER TABLE "voicemails" ADD COLUMN IF NOT EXISTS "order_id" integer;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voicemails_order_idx" ON "voicemails" ("order_id");
