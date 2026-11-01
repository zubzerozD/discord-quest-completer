//! Fuzzy search over the catalog with fuse.js, deterministic under test.
import Fuse from "fuse.js";
import type { GameEntry } from "../catalog/catalog";

/** Caps result count so a broad query cannot flood the DOM. */
export const SEARCH_LIMIT = 50;

/**
 * Builds a query function over `games`: an empty/whitespace query returns the
 * ordered list unchanged (pre-sorted view), a real query fuzzy-matches name,
 * aliases, and executable names. Gibberish yields an empty array.
 */
export function createSearch(
  games: GameEntry[],
): (query: string) => GameEntry[] {
  const fuse = new Fuse(games, {
    keys: ["name", "aliases", "executables.name"],
    threshold: 0.4,
    ignoreLocation: true,
  });
  return (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) {
      return games;
    }
    return fuse
      .search(trimmed, { limit: SEARCH_LIMIT })
      .map((result) => result.item);
  };
}

/** Alphabetical, case-insensitive, stable ordering by display name. */
export function sortByName(games: GameEntry[]): GameEntry[] {
  return [...games].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}
