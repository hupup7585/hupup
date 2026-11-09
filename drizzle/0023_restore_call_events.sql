-- Migration 0016 (call_events) was dated earlier than 0015, so databases that already had 0015 skipped it.
-- Create it now only if it's missing. Nothing is dropped or deleted.
CREATE TABLE IF NOT EXISTS "call_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"call_sid" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"step" text,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "call_events_call_idx" ON "call_events" USING btree ("call_sid","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "call_events_kind_idx" ON "call_events" USING btree ("kind","at");
