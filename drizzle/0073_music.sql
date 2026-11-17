-- Abraham, Nov 17, 2026: music uploaded in Admin, played like a radio
CREATE TABLE IF NOT EXISTS "music_tracks" (
  "id" serial PRIMARY KEY,
  "name" text NOT NULL,
  "pieces" integer NOT NULL DEFAULT 0,
  "piece_seconds" integer NOT NULL DEFAULT 8,
  "duration_sec" integer NOT NULL DEFAULT 0,
  "complete" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "trashed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "music_radio" (
  "place" text PRIMARY KEY,
  "track_pos" integer NOT NULL DEFAULT 0,
  "piece" integer NOT NULL DEFAULT 0,
  "started_at" timestamp with time zone NOT NULL DEFAULT now()
);
