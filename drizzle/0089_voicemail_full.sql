-- Full voicemail by phone (Abraham, Nov 23, 2026)
ALTER TABLE "voicemail_boxes" ADD COLUMN IF NOT EXISTS "owner_user_id" integer UNIQUE;
--> statement-breakpoint
ALTER TABLE "voicemail_boxes" ADD COLUMN IF NOT EXISTS "box_number" text UNIQUE;
--> statement-breakpoint
ALTER TABLE "voicemail_boxes" ADD COLUMN IF NOT EXISTS "pin_hash" text;
--> statement-breakpoint
ALTER TABLE "voicemail_boxes" ADD COLUMN IF NOT EXISTS "wrong_tries" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "voicemail_boxes" ADD COLUMN IF NOT EXISTS "locked_until" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "voicemail_boxes" ADD COLUMN IF NOT EXISTS "greeting_key" text;
--> statement-breakpoint
ALTER TABLE "voicemail_boxes" ADD COLUMN IF NOT EXISTS "name_key" text;
--> statement-breakpoint
ALTER TABLE "voicemail_boxes" ADD COLUMN IF NOT EXISTS "alerts_on" boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE "voicemails" ADD COLUMN IF NOT EXISTS "saved_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "voicemails" ADD COLUMN IF NOT EXISTS "pieces" integer;
--> statement-breakpoint
ALTER TABLE "voicemails" ADD COLUMN IF NOT EXISTS "from_box_id" integer;
--> statement-breakpoint
ALTER TABLE "voicemails" ADD COLUMN IF NOT EXISTS "audio_of" integer;
--> statement-breakpoint
ALTER TABLE "voicemails" ADD COLUMN IF NOT EXISTS "note_key" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "voicemail_actions" (
  "id" serial PRIMARY KEY,
  "box_id" integer,
  "voicemail_id" integer,
  "user_id" integer,
  "action" text NOT NULL,
  "detail" text,
  "call_sid" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
