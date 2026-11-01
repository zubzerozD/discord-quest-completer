import { describe, expect, it } from "vitest";
import type { GameEntry } from "../catalog/catalog";
import { createSearch, SEARCH_LIMIT, sortByName } from "./search";

const G = (id: string, name: string, extra: Partial<GameEntry> = {}): GameEntry => ({
  id,
  name,
  aliases: [],
  executables: [],
  ...extra,
});

const OVERWATCH = G("1", "Overwatch", {
  executables: [{ name: "overwatch.exe", os: "win32" }],
});
const OW_ART = G("2", "Overwatch 2", { aliases: ["ow2"] });
const VALORANT = G("3", "VALORANT");

describe("sortByName", () => {
  it("orders alphabetically, case-insensitively", () => {
    const sorted = sortByName([VALORANT, OVERWATCH, OW_ART]);
    expect(sorted.map((g) => g.name)).toEqual([
      "Overwatch",
      "Overwatch 2",
      "VALORANT",
    ]);
  });

  it("does not mutate the input", () => {
    const input = [VALORANT, OVERWATCH];
    sortByName(input);
    expect(input[0]).toBe(VALORANT);
  });
});

describe("createSearch", () => {
  const games = sortByName([OVERWATCH, OW_ART, VALORANT]);
  const search = createSearch(games);

  it("empty query returns the ordered list unchanged", () => {
    expect(search("")).toEqual(games);
    expect(search("   ")).toEqual(games);
  });

  it("matches by name fragment", () => {
    expect(search("over").map((g) => g.name)).toEqual([
      "Overwatch",
      "Overwatch 2",
    ]);
  });

  it("matches by alias", () => {
    expect(search("ow2").map((g) => g.name)).toEqual(["Overwatch 2"]);
  });

  it("matches by executable name that does not appear in the display name", () => {
    // Only the executables.name key can surface this hit: neither the game
    // name nor its aliases contain "javaw".
    const launcher = G("4", "Launcher Test", {
      executables: [{ name: "javaw.exe", os: "win32" }],
    });
    const searchWithLauncher = createSearch(sortByName([...games, launcher]));
    expect(searchWithLauncher("javaw.exe").map((g) => g.name)).toEqual([
      "Launcher Test",
    ]);
  });

  it("gibberish yields an empty array", () => {
    expect(search("zx9q!#nothing")).toEqual([]);
  });

  it("caps results at SEARCH_LIMIT", () => {
    const many = Array.from({ length: SEARCH_LIMIT + 25 }, (_, i) =>
      G(String(i), `Zebra Game ${i}`),
    );
    const bigSearch = createSearch(many);
    expect(bigSearch("zebra")).toHaveLength(SEARCH_LIMIT);
  });
});
