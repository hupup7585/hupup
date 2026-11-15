-- Abraham (Nov 14, 2026): key 6 Delivery and Pickup keeps ringing after the office closes, until 10:30 PM.
INSERT INTO app_settings ("key", "value") VALUES ('ringAfterHours6', 'true'::jsonb)
ON CONFLICT ("key") DO UPDATE SET "value" = 'true'::jsonb;
