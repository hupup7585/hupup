import "dotenv/config";
import { getDb, closeDb, schema } from "../src/lib/db";

/**
 * Starter catalog. These are SAMPLE items/prices — edit them in /admin/catalog.
 * Safe to run once on an empty database; it skips if categories already exist.
 */
async function main() {
  if (!process.env.DATABASE_URL) {
    console.log("No DATABASE_URL set - skipping seed.");
    return;
  }
  const db = getDb();
  const existing = await db.select().from(schema.categories).limit(1);
  if (existing.length) {
    console.log("Catalog already has data - skipping seed.");
    return closeDb();
  }
  const [bounce, laser, paddle] = await db
    .insert(schema.categories)
    .values([
      { name: "Bounce Houses", spokenName: "Bounce Houses", ivrDigit: 1, emoji: "🏰", sortOrder: 1, description: "Bring excitement to your event with our bounce house rentals. Perfect for parties, celebrations, school events, and special occasions." },
      { name: "Laser Tag and Inflatable Mazes", spokenName: "Laser Tag and Inflatable Mazes", ivrDigit: 2, emoji: "🎯", sortOrder: 2, description: "Create an unforgettable experience with our laser tag and inflatable maze attractions. A great addition to events, parties, and group activities." },
      { name: "Paddle Boats", spokenName: "Paddle Boats", ivrDigit: 3, emoji: "🚣", sortOrder: 3, description: "Add something special to your event with our paddle boat rentals. An exciting attraction for outdoor events and special occasions." },
    ])
    .returning();

  await db.insert(schema.products).values([
    { categoryId: bounce.id, name: "Royal Castle Combo", priceCents: 23000, quantity: 2, sortOrder: 1, description: "Bounce house with a slide and basketball hoop. 15 by 15 feet.", spokenDescription: "The Royal Castle Combo is a bounce house with a built-in slide and basketball hoop. It's fifteen by fifteen feet and fits about eight kids at a time." },
    { categoryId: bounce.id, name: "Mega Slide Jumper", priceCents: 26000, quantity: 1, sortOrder: 2, description: "Tall dual-lane slide with a bounce area.", spokenDescription: "The Mega Slide Jumper has a tall dual-lane slide and a big bounce area. Great for older kids." },
    { categoryId: bounce.id, name: "Toddler Bounce", priceCents: 12000, quantity: 3, sortOrder: 3, description: "Low, gentle bouncer for ages 2 to 5.", spokenDescription: "The Toddler Bounce is a low, gentle bouncer with soft walls, made for children ages two to five." },
    { categoryId: laser.id, name: "Laser Tag Arena + Maze", priceCents: 30000, quantity: 1, sortOrder: 1, description: "10 laser tag blasters with a giant inflatable maze arena.", spokenDescription: "The Laser Tag Arena comes with ten laser tag blasters and vests, plus a giant inflatable maze to play in. Perfect for groups of ten to thirty." },
    { categoryId: paddle.id, name: "Paddle Boat", priceCents: 4500, quantity: 8, sortOrder: 1, description: "Single paddle boat for pools. Rent as many as you need.", spokenDescription: "Our paddle boats are pool-ready and easy for kids to steer. You can rent as many as you need." },
  ]);
  console.log("Seeded sample catalog.");
  await closeDb();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
