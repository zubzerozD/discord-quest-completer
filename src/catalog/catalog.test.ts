import { describe, expect, it } from "vitest";
import {
  CACHE_KEY,
  filterWindows,
  isValidPayload,
  loadCatalog,
  sanitize,
  type CatalogDeps,
  type GameEntry,
  type Storage,
} from "./catalog";

const OVERWATCH: GameEntry = {
  id: "356875221078245376",
  name: "Overwatch",
  aliases: [],
  executables: [{ name: "overwatch.exe", os: "win32" }],
};

const MAC_ONLY: GameEntry = {
  id: "999",
  name: "Mac Game",
  aliases: [],
  executables: [{ name: "macgame", os: "darwin" }],
};

const BUNDLED_RAW = JSON.stringify([OVERWATCH, MAC_ONLY]);

function memoryStorage(initial?: Record<string, string>): Storage & { data: Record<string, string> } {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    get: (key) => (key in data ? data[key] : null),
    set: (key, value) => {
      data[key] = value;
    },
  };
}

function deps(overrides: Partial<CatalogDeps> = {}): { deps: CatalogDeps; storage: ReturnType<typeof memoryStorage> } {
  const storage = memoryStorage();
  return {
    storage,
    deps: {
      fetchLive: async () => [OVERWATCH, MAC_ONLY],
      storage,
      bundledRaw: BUNDLED_RAW,
      now: () => 1_700_000_000_000,
      ...overrides,
    },
  };
}

describe("isValidPayload", () => {
  it("accepts an array of well-formed entries", () => {
    expect(isValidPayload([OVERWATCH])).toBe(true);
  });

  it("rejects non-arrays, null, and malformed entries", () => {
    expect(isValidPayload(null)).toBe(false);
    expect(isValidPayload({})).toBe(false);
    expect(isValidPayload([{ name: "x" }])).toBe(false); // missing fields
    expect(isValidPayload([42])).toBe(false);
  });
});

describe("filterWindows / sanitize", () => {
  it("keeps win32 entries and drops mac-only ones", () => {
    expect(filterWindows([OVERWATCH, MAC_ONLY])).toEqual([OVERWATCH]);
  });

  it("drops entries whose executables are not an array", () => {
    const broken = { id: "1", name: "x", aliases: [], executables: "nope" } as unknown as GameEntry;
    expect(filterWindows([broken])).toEqual([]);
  });

  it("sanitize returns null for unusable payloads", () => {
    expect(sanitize(null)).toBeNull();
    expect(sanitize([MAC_ONLY])).toBeNull(); // valid but empty after win32 filter
  });

  it("sanitize returns filtered games for a good payload", () => {
    expect(sanitize([OVERWATCH, MAC_ONLY])).toEqual([OVERWATCH]);
  });
});

describe("loadCatalog", () => {
  it("uses the live tier and persists a cache entry on success", async () => {
    const { deps: d, storage } = deps();
    const result = await loadCatalog(d);

    expect(result.source).toBe("live");
    expect(result.games).toEqual([OVERWATCH]); // win32-filtered
    expect(result.fetchedAt).toBe(1_700_000_000_000);
    const cached = JSON.parse(storage.data[CACHE_KEY]);
    expect(cached.t).toBe(1_700_000_000_000);
    expect(cached.games).toEqual([OVERWATCH]);
  });

  it("falls back to the cache when the network fails", async () => {
    const { deps: d, storage } = deps({
      fetchLive: async () => {
        throw new Error("offline");
      },
    });
    storage.set(
      CACHE_KEY,
      JSON.stringify({ t: 1_690_000_000_000, games: [OVERWATCH] }),
    );

    const result = await loadCatalog(d);
    expect(result.source).toBe("cached");
    expect(result.games).toEqual([OVERWATCH]);
    expect(result.fetchedAt).toBe(1_690_000_000_000);
  });

  it("falls back to bundled when the network fails and there is no cache", async () => {
    const { deps: d } = deps({
      fetchLive: async () => {
        throw new Error("offline");
      },
    });

    const result = await loadCatalog(d);
    expect(result.source).toBe("fallback");
    expect(result.games).toEqual([OVERWATCH]);
    expect(result.fetchedAt).toBeUndefined();
  });

  it("treats a live payload that fails validation as a tier failure", async () => {
    const { deps: d, storage } = deps({
      fetchLive: async () => ({ unexpected: "shape" }),
    });
    storage.set(CACHE_KEY, JSON.stringify({ t: 5, games: [OVERWATCH] }));

    const result = await loadCatalog(d);
    expect(result.source).toBe("cached"); // live rejected → cache wins
    expect(result.games).toEqual([OVERWATCH]);
  });

  it("skips a corrupt cache entry and reaches the bundled snapshot", async () => {
    const { deps: d, storage } = deps({
      fetchLive: async () => {
        throw new Error("offline");
      },
    });
    storage.set(CACHE_KEY, "not-json{{{");

    const result = await loadCatalog(d);
    expect(result.source).toBe("fallback");
    expect(result.games).toEqual([OVERWATCH]);
  });

  it("falls through live → cache → bundled when every upper tier is unusable", async () => {
    const { deps: d, storage } = deps({
      fetchLive: async () => [MAC_ONLY], // valid shape, empty after filter
    });
    storage.set(CACHE_KEY, JSON.stringify({ t: 7, games: "garbage" }));

    const result = await loadCatalog(d);
    expect(result.source).toBe("fallback");
    expect(result.games).toEqual([OVERWATCH]);
  });
});
