-- Abraham (Phone Recordings): every phone line can have his uploaded recording (MP3 or WAV) or a Google voice recording.
-- Old recordings are never deleted. voice_prompts.recording_id = the upload that plays now (null = Google voice).
CREATE TABLE IF NOT EXISTS "prompt_recordings" (
  "id" serial PRIMARY KEY,
  "prompt_key" text NOT NULL,
  "source" text NOT NULL,
  "file_name" text NOT NULL,
  "content_type" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "wording" text,
  "complete" boolean NOT NULL DEFAULT false,
  "created_by" integer,
  "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prompt_recordings_key_idx" ON "prompt_recordings" ("prompt_key");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "prompt_recording_chunks" (
  "recording_id" integer NOT NULL REFERENCES "prompt_recordings"("id"),
  "idx" integer NOT NULL,
  "data" bytea NOT NULL,
  PRIMARY KEY ("recording_id", "idx")
);--> statement-breakpoint
ALTER TABLE "voice_prompts" ADD COLUMN IF NOT EXISTS "recording_id" integer;--> statement-breakpoint
ALTER TABLE "voice_prompts" ADD COLUMN IF NOT EXISTS "approved_at" timestamptz;--> statement-breakpoint
ALTER TABLE "voice_prompts" ADD COLUMN IF NOT EXISTS "approved_by" integer;
