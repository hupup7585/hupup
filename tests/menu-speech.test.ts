import { describe, expect, it } from "vitest";
import { matchMenuSpeech, menuSpeechHints } from "@/lib/ivr/category-speech";

const cats = [
  { id: 1, name: "Jumping Balloons", spokenName: "Jumping Balloons" },
  { id: 2, name: "Laser Tag and Inflatable Mazes", spokenName: "Laser Tag and Inflatable Mazes" },
  { id: 3, name: "Paddle Boats", spokenName: "Paddle Boats" },
];

describe("main menu speech", () => {
  it.each([
    ["Jumping balloons", 1],
    ["I need a bounce house", 1],
    ["bouncy castle please", 1],
    ["a jumper for my kids", 1],
    ["laser tag", 2],
    ["the maze", 2],
    ["paddle boats", 3],
    ["a boat", 3],
  ])("%s -> category %i", (said, id) => {
    expect(matchMenuSpeech(said, cats)).toEqual({ kind: "category", categoryId: id });
  });
  it("still understands 'bounce house' if the category is still named Bounce Houses", () => {
    expect(matchMenuSpeech("bounce house", [{ id: 9, name: "Bounce Houses", spokenName: "Bounce Houses" }])).toEqual({ kind: "category", categoryId: 9 });
  });
  it("understands operator, cart and repeat requests", () => {
    expect(matchMenuSpeech("can I talk to someone", cats)).toEqual({ kind: "operator" });
    expect(matchMenuSpeech("check out", cats)).toEqual({ kind: "cart" });
    expect(matchMenuSpeech("repeat that", cats)).toEqual({ kind: "repeat" });
  });
  it("returns nothing for unrelated speech", () => {
    expect(matchMenuSpeech("what's the weather", cats)).toBeNull();
    expect(matchMenuSpeech("", cats)).toBeNull();
  });
  it("hints include the new name and 'bounce house'", () => {
    const h = menuSpeechHints(cats);
    expect(h).toContain("Jumping Balloons");
    expect(h).toContain("bounce house");
  });
});
