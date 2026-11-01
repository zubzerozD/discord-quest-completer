import { describe, expect, it } from "vitest";
import type { Storage } from "../catalog/catalog";
import {
  FAVORITES_KEY,
  loadFavorites,
  saveFavorites,
  toggleFavorite,
} from "./favorites";

function memoryStorage(initial?: Record<string, string>): Storage & {
  data: Record<string, string>;
} {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    get: (key) => (key in data ? data[key] : null),
    set: (key, value) => {
      data[key] = value;
    },
  };
}

describe("toggleFavorite", () => {
  it("adds an id at the front when absent", () => {
    expect(toggleFavorite(["a"], "b")).toEqual(["b", "a"]);
  });

  it("removes an id when present", () => {
    expect(toggleFavorite(["b", "a"], "b")).toEqual(["a"]);
  });

  it("toggling twice returns to the original list", () => {
    const once = toggleFavorite(["a"], "b");
    expect(toggleFavorite(once, "b")).toEqual(["a"]);
  });
});

describe("loadFavorites", () => {
  it("returns stored ids", () => {
    const storage = memoryStorage({ [FAVORITES_KEY]: '["x","y"]' });
    expect(loadFavorites(storage)).toEqual(["x", "y"]);
  });

  it("returns [] when the key is absent", () => {
    expect(loadFavorites(memoryStorage())).toEqual([]);
  });

  it("tolerates corrupt JSON", () => {
    const storage = memoryStorage({ [FAVORITES_KEY]: "{{{not json" });
    expect(loadFavorites(storage)).toEqual([]);
  });

  it("drops non-string entries from hostile payloads", () => {
    const storage = memoryStorage({
      [FAVORITES_KEY]: '["ok", 42, null, {"a":1}]',
    });
    expect(loadFavorites(storage)).toEqual(["ok"]);
  });
});

describe("saveFavorites", () => {
  it("round-trips through loadFavorites", () => {
    const storage = memoryStorage();
    saveFavorites(storage, ["g1", "g2"]);
    expect(loadFavorites(storage)).toEqual(["g1", "g2"]);
  });
});
