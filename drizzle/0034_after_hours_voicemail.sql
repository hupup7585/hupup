-- Abraham (Nov 12, 2026, section 17): after business hours, Shabbos and Yom Tov every extension goes to voicemail.
-- Sets the per-extension after-hours switch to off (voicemail) for every line; Admin can turn one back on.
INSERT INTO app_settings (key, value, updated_at) VALUES ('ringAfterHours0', 'false'::jsonb, now()), ('ringAfterHours2', 'false'::jsonb, now()), ('ringAfterHours4', 'false'::jsonb, now()), ('ringAfterHours5', 'false'::jsonb, now()), ('ringAfterHours6', 'false'::jsonb, now()), ('ringAfterHours8', 'false'::jsonb, now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();--> statement-breakpoint
INSERT INTO audit_log (action, entity_type, after) VALUES ('settings.after_hours_voicemail', 'settings', '{"afterHoursRinging":"off for every extension","by":"Abraham, Nov 12, 2026 (migration 0034)"}'::jsonb);
