CREATE TABLE IF NOT EXISTS "geocode_cache" (
  "address" text PRIMARY KEY NOT NULL,
  "lat" double precision,
  "lng" double precision,
  "source" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
