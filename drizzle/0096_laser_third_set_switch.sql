-- Laser tag: every third set half price (Abraham, Nov 25, 2026, 4:03 PM): the old "third pack" offer switch is deleted
DELETE FROM "app_settings" WHERE "key" = 'offerLaserThirdPackOn';
