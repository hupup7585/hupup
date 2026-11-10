-- Abraham (Nov 10, 2026): "Voicemail MP3 by text (MMS): I need it. Turn it on once Twilio works."
-- Switched on now; it only sends once Twilio approves texting (A2P). Nothing deleted.
INSERT INTO app_settings (key, value, updated_at) VALUES ('voicemailMms', 'true'::jsonb, now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();--> statement-breakpoint
INSERT INTO audit_log (action, entity_type, after) VALUES ('settings.voicemail_mms_on', 'settings', '{"voicemailMms":true,"by":"Abraham request (migration 0028)"}'::jsonb);
