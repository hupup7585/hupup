-- Ocean balls (Abraham, Nov 17, 2026): offered after every jumping balloon on the phone line. A hidden category
-- (not active, no phone key): never on the website, the phone menus or the catalog, but its items can go on an order,
-- so they are on the order and in the payment total. Prices editable in Admin, Catalog.
INSERT INTO "categories" ("name", "description", "spoken_name", "ivr_digit", "sort_order", "active")
  SELECT 'Ocean balls', 'Add-on after a jumping balloon (phone line)', 'ocean balls', NULL, 99, false
  WHERE NOT EXISTS (SELECT 1 FROM "categories" WHERE "name" = 'Ocean balls');
--> statement-breakpoint
INSERT INTO "products" ("category_id", "name", "description", "price_cents", "quantity", "size_order", "sort_order", "active")
  SELECT c."id", v."name", v."description", v."price", 999, v."size", v."size", true
  FROM "categories" c,
       (VALUES ('200 ocean balls', '200 ocean balls for a jumping balloon', 1000, 1),
               ('500 ocean balls', '500 ocean balls for a jumping balloon', 1500, 2),
               ('700 ocean balls', '700 ocean balls for a jumping balloon', 2000, 3)) AS v("name", "description", "price", "size")
  WHERE c."name" = 'Ocean balls'
    AND NOT EXISTS (SELECT 1 FROM "products" p WHERE p."category_id" = c."id" AND p."size_order" = v."size");
