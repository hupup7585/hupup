-- Abram: rename "Bounce Houses" to "Jumping Balloons" on the website, with matching description.
-- Only touches the starter row if it still has the original name; the phone menu wording
-- (spoken_name) is left unchanged here.
UPDATE "categories"
SET "name" = 'Jumping Balloons',
    "description" = 'Bring excitement to your event with our jumping balloon rentals. Perfect for parties, celebrations, school events, and special occasions.'
WHERE "name" = 'Bounce Houses';
