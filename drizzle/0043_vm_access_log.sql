CREATE TABLE IF NOT EXISTS "vm_access_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"call_sid" text,
	"from_number" text,
	"result" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vm_access_log_created_idx" ON "vm_access_log" ("created_at");
