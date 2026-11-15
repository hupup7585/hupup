CREATE TABLE IF NOT EXISTS "recording_slots" (
  "key" text PRIMARY KEY NOT NULL,
  "confirmed_text" text,
  "confirmed_at" timestamp with time zone,
  "confirmed_by" integer,
  "recorded_at" timestamp with time zone,
  "recorded_by" integer
);
