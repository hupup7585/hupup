-- Abraham (Nov 11, 2026): one voicemail box per extension, and the voicemail review menu (1 send, 2 listen,
-- 3 re-record). Existing messages stay exactly as they are (submitted, ready). Nothing deleted.
ALTER TABLE "voicemail_boxes" ADD COLUMN IF NOT EXISTS "extension_key" text UNIQUE;--> statement-breakpoint
ALTER TABLE "voicemails" ADD COLUMN IF NOT EXISTS "state" text NOT NULL DEFAULT 'submitted';--> statement-breakpoint
ALTER TABLE "voicemails" ADD COLUMN IF NOT EXISTS "ready" boolean NOT NULL DEFAULT true;--> statement-breakpoint
ALTER TABLE "voicemails" ADD COLUMN IF NOT EXISTS "note" text;
