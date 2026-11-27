/**
 * Website content that needs no database (client-safe): the rental categories shown when the database can't be read,
 * used by getSiteContent's fallback and by the error page's footer.
 */
export const DEFAULT_CATEGORIES = [
  { id: 1, name: "Jumping Balloons", description: "Bring excitement to your event with our jumping balloon rentals. Perfect for parties, celebrations, school events, and special occasions." },
  { id: 2, name: "Laser Tag and Inflatable Mazes", description: "Create an unforgettable experience with our laser tag and inflatable maze attractions. A great addition to events, parties, and group activities." },
  { id: 3, name: "Paddle Boats", description: "Add something special to your event with our paddle boat rentals. An exciting attraction for outdoor events and special occasions." },
];

export function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
