ALTER TABLE "inbox_emails" ADD COLUMN IF NOT EXISTS "starred" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "inbox_emails" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "inbox_emails" ADD COLUMN IF NOT EXISTS "trashed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "inbox_emails" ADD COLUMN IF NOT EXISTS "labels" text[] DEFAULT '{}' NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inbox_labels" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#2585D8' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inbox_labels_name_idx" ON "inbox_labels" ("name");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inbox_drafts" (
	"id" serial PRIMARY KEY NOT NULL,
	"reply_to_email_id" integer REFERENCES "inbox_emails"("id"),
	"forward_of_email_id" integer REFERENCES "inbox_emails"("id"),
	"to_address" text DEFAULT '' NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"user_id" integer,
	"sent_reply_id" integer,
	"discarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
