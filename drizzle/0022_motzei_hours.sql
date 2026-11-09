-- Abraham: Motzei Shabbos office hours, exactly: Winter 2 hours after Shabbos - 11:00 PM; Summer 2 hours after Shabbos - 12:00 AM.
-- Saved in Admin Settings, which the website's Our Hours card and the phone line both read. Other days are unchanged.
INSERT INTO app_settings (key, value, updated_at) VALUES
  ('hoursMotzeiOpen', '"tzeis+120"'::jsonb, now()),
  ('hoursMotzeiCloseWinter', '"23:00"'::jsonb, now()),
  ('hoursMotzeiCloseSummer', '"00:00"'::jsonb, now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();--> statement-breakpoint
INSERT INTO audit_log (action, entity_type, after) VALUES ('settings.calendar_changed', 'settings', '{"hoursMotzeiOpen":"tzeis+120","hoursMotzeiCloseWinter":"23:00","hoursMotzeiCloseSummer":"00:00","by":"Abraham request (migration 0022)"}'::jsonb);
