-- Abraham (Nov 14, 2026): candle lighting in Monroe is 15 minutes before the first shkia; reopen after Shabbos and
-- Yom Tov at Rabbeinu Tam, 72 minutes after sunset. Both stay editable in Admin.
INSERT INTO app_settings ("key", "value") VALUES ('candleLightingMinutes', '"15"'::jsonb)
ON CONFLICT ("key") DO UPDATE SET "value" = '"15"'::jsonb;
--> statement-breakpoint
INSERT INTO app_settings ("key", "value") VALUES ('reopenAfter', '"72"'::jsonb)
ON CONFLICT ("key") DO UPDATE SET "value" = '"72"'::jsonb;
