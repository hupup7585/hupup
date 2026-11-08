CREATE TABLE "call_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"call_sid" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"step" text,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "call_events_call_idx" ON "call_events" USING btree ("call_sid","id");--> statement-breakpoint
CREATE INDEX "call_events_kind_idx" ON "call_events" USING btree ("kind","at");