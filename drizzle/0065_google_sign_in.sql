-- Admin sign-in with Google (Abraham, Nov 16, 2026): the Google email the Owner saved on a staff member
ALTER TABLE "admin_users" ADD COLUMN IF NOT EXISTS "google_email" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "admin_users_google_email_idx" ON "admin_users" (lower("google_email"));
