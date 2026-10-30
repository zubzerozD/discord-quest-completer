//! Live game catalog with a three-tier fallback chain: Discord's API at
//! runtime, then the last successful fetch persisted locally, then the
//! snapshot bundled with the app. Every tier validates the payload before
//! accepting it, so a broken response falls through instead of crashing
//! (upstream panicked on network errors).
//!
//! All dependencies are injected so this module stays framework-free and
//! deterministic under test.

export type CatalogSource = "live" | "cached" | "fallback";

export interface Executable {
  name: string;
  os: string;
  is_launcher?: boolean;
}

export interface GameEntry {
  id: string;
  name: string;
  aliases: string[];
  executables: Executable[];
}

export interface LoadResult {
  games: GameEntry[];
  source: CatalogSource;
  /** Epoch ms of the fetch that produced the data; absent for the bundled snapshot. */
  fetchedAt?: number;
}

export interface Storage {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export interface CatalogDeps {
  /** Performs the network request; must throw on failure. */
  fetchLive: () => Promise<unknown>;
  storage: Storage;
  /** Raw JSON string of the bundled snapshot (parsed lazily — it is ~12MB). */
  bundledRaw: string;
  now: () => number;
}

export const CACHE_KEY = "dqc.catalog.v1";

/** True when the payload is an array of structurally sound entries. */
export function isValidPayload(data: unknown): data is GameEntry[] {
  if (!Array.isArray(data)) {
    return false;
  }
  return data.every(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as GameEntry).id === "string" &&
      typeof (entry as GameEntry).name === "string" &&
      Array.isArray((entry as GameEntry).aliases) &&
      Array.isArray((entry as GameEntry).executables),
  );
}

/** Keeps only entries with at least one win32 executable (all this app can run). */
export function filterWindows(games: GameEntry[]): GameEntry[] {
  return games.filter(
    (game) =>
      Array.isArray(game.executables) &&
      game.executables.some(
        (exe) =>
          typeof exe === "object" &&
          exe !== null &&
          typeof exe.name === "string" &&
          exe.os === "win32",
      ),
  );
}

/** Validates, filters, and returns null when the payload is unusable. */
export function sanitize(data: unknown): GameEntry[] | null {
  if (!isValidPayload(data)) {
    return null;
  }
  const filtered = filterWindows(data);
  return filtered.length > 0 ? filtered : null;
}

interface CacheEntry {
  t: number;
  games: GameEntry[];
}

function parseCache(raw: string | null): CacheEntry | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as CacheEntry;
    if (typeof parsed.t !== "number") {
      return null;
    }
    const games = sanitize(parsed.games);
    return games ? { t: parsed.t, games } : null;
  } catch {
    return null;
  }
}

/**
 * Loads the catalog through live → cache → bundled, returning which tier won.
 * Never throws: a tier that fails or yields an unusable payload falls through.
 */
export async function loadCatalog(deps: CatalogDeps): Promise<LoadResult> {
  try {
    const payload = await deps.fetchLive();
    const games = sanitize(payload);
    if (games) {
      const fetchedAt = deps.now();
      deps.storage.set(CACHE_KEY, JSON.stringify({ t: fetchedAt, games }));
      return { games, source: "live", fetchedAt };
    }
  } catch {
    // Network failure falls through to the cache, exactly like a bad payload.
  }

  const cached = parseCache(deps.storage.get(CACHE_KEY));
  if (cached) {
    return { games: cached.games, source: "cached", fetchedAt: cached.t };
  }

  // Last resort: parse the bundled snapshot lazily (it is ~12MB).
  let bundled: unknown;
  try {
    bundled = JSON.parse(deps.bundledRaw);
  } catch {
    bundled = null;
  }
  const games = sanitize(bundled) ?? [];
  return { games, source: "fallback" };
}
