-- Abraham (approved): main menu key 6, Delivery and Pickup, rings (845) 213-5239 during business hours, then voicemail.
-- Adds the number to the key 6 ring list (25 seconds a ring) without removing any number already there.
INSERT INTO app_settings ("key", "value") VALUES ('ringTargets6', to_jsonb('Delivery and Pickup|+18452135239|25'::text))
ON CONFLICT ("key") DO UPDATE SET "value" = CASE
  WHEN COALESCE(app_settings."value" #>> '{}', '') = '' THEN to_jsonb('Delivery and Pickup|+18452135239|25'::text)
  WHEN regexp_replace(app_settings."value" #>> '{}', '\D', '', 'g') LIKE '%8452135239%' THEN app_settings."value"
  ELSE to_jsonb((app_settings."value" #>> '{}') || E'\nDelivery and Pickup|+18452135239|25')
END;
