-- Abraham, Nov 18, 2026: keep the Owner's original song file (full quality) in R2 for Download and full playback
ALTER TABLE "music_tracks" ADD COLUMN IF NOT EXISTS "original_name" text;
--> statement-breakpoint
ALTER TABLE "music_tracks" ADD COLUMN IF NOT EXISTS "original_type" text;
--> statement-breakpoint
ALTER TABLE "music_tracks" ADD COLUMN IF NOT EXISTS "original_bytes" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "music_tracks" ADD COLUMN IF NOT EXISTS "original_pieces" integer NOT NULL DEFAULT 0;
