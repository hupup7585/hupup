-- Abraham (Nov 13, 2026): spoken answers are recorded, typed up (speech to text) and read back. Each recording is
-- kept on the order and contact so staff can play it if the text is wrong. Preview only until Abraham approves.
CREATE TABLE IF NOT EXISTS "spoken_answers" (
  "id" serial PRIMARY KEY,
  "call_sid" text NOT NULL,
  "field" text NOT NULL,
  "recording_sid" text,
  "recording_url" text,
  "duration_sec" integer,
  "text" text,
  "status" text NOT NULL DEFAULT 'pending',
  "error" text,
  "order_id" integer,
  "customer_id" integer,
  "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "spoken_answers_call_idx" ON "spoken_answers" ("call_sid");
