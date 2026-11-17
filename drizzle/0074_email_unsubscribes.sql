-- Abraham, Nov 17, 2026: unsubscribe link on promotional emails
CREATE TABLE IF NOT EXISTS "email_unsubscribes" (
  "email" text PRIMARY KEY,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
