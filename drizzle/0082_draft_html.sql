-- Abraham, Nov 19, 2026: formatted emails (Gmail-style bar) keep their formatting when scheduled
ALTER TABLE "inbox_drafts" ADD COLUMN IF NOT EXISTS "body_html" text;
