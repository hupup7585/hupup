-- Combined recordings remember the lines they were made for (Hark's Phases 1-3 review, item 1). Additive; null = an
-- older combined recording, which keeps playing as today until it is chosen again.
ALTER TABLE "voice_prompts" ADD COLUMN IF NOT EXISTS "line_set" text;
