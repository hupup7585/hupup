CREATE TABLE IF NOT EXISTS "api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"service" text NOT NULL,
	"purpose" text,
	"mode" text DEFAULT 'test' NOT NULL,
	"value_enc" text NOT NULL,
	"last4" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" integer,
	"vercel_synced_at" timestamp with time zone,
	"vercel_error" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "api_keys_name_idx" ON "api_keys" ("name");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api_keys_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" integer,
	"action" text NOT NULL,
	"key_name" text,
	"ok" boolean DEFAULT true NOT NULL,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_keys_log_at_idx" ON "api_keys_log" ("at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api_keys_log_no_change() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'api_keys_log is append-only'; END; $$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS api_keys_log_append_only ON "api_keys_log";
--> statement-breakpoint
CREATE TRIGGER api_keys_log_append_only BEFORE UPDATE OR DELETE ON "api_keys_log" FOR EACH ROW EXECUTE FUNCTION api_keys_log_no_change();
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api_keys_unlocks" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
