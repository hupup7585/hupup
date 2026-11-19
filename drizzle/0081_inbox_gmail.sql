-- Abraham, Nov 19, 2026: the Admin Inbox like Gmail (snooze, important, spam, scheduled send)
ALTER TABLE "inbox_emails" ADD COLUMN IF NOT EXISTS "snoozed_until" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "inbox_emails" ADD COLUMN IF NOT EXISTS "important" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "inbox_emails" ADD COLUMN IF NOT EXISTS "spam_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "inbox_drafts" ADD COLUMN IF NOT EXISTS "send_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "inbox_drafts" ADD COLUMN IF NOT EXISTS "file_ids" integer[] NOT NULL DEFAULT '{}'::integer[];
--> statement-breakpoint
ALTER TABLE "inbox_drafts" ADD COLUMN IF NOT EXISTS "attach_catalog" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "inbox_drafts" ADD COLUMN IF NOT EXISTS "send_error" text;
