CREATE TABLE IF NOT EXISTS "job_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"ok" boolean,
	"attempts" integer DEFAULT 1 NOT NULL,
	"result" jsonb,
	"error" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_runs_name_idx" ON "job_runs" ("name", "started_at");
