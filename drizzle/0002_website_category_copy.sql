-- Website copy from Abram's spec, applied only to the original starter categories
-- (anything the owner already edited in /admin is left alone).
UPDATE "categories" SET "description" = 'Bring excitement to your event with our bounce house rentals. Perfect for parties, celebrations, school events, and special occasions.'
WHERE "name" = 'Bounce Houses' AND "description" = 'Castles, combos and slides — cleaned, safe, and set up by our crew.';
--> statement-breakpoint
UPDATE "categories" SET "name" = 'Laser Tag and Inflatable Mazes', "description" = 'Create an unforgettable experience with our laser tag and inflatable maze attractions. A great addition to events, parties, and group activities.'
WHERE "name" = 'Laser Tag & Inflatable Mazes' AND "description" = 'Full laser tag kits with giant inflatable arenas — perfect for groups.';
--> statement-breakpoint
UPDATE "categories" SET "description" = 'Add something special to your event with our paddle boat rentals. An exciting attraction for outdoor events and special occasions.'
WHERE "name" = 'Paddle Boats' AND "description" = 'Pool-ready paddle boats for summer splash days.';
