//! Favorites persistence: pure list logic plus injected storage, so the rules
//! are unit-testable without a DOM.
import type { Storage } from "../catalog/catalog";

export const FAVORITES_KEY = "dqc.favorites.v1";

/** Loads favorites, tolerating corrupt or hostile stored values. */
export function loadFavorites(storage: Storage): string[] {
  const raw = storage.get(FAVORITES_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

/** Persists the favorite ids. */
export function saveFavorites(storage: Storage, ids: string[]): void {
  storage.set(FAVORITES_KEY, JSON.stringify(ids));
}

/**
 * Returns the list with `id` toggled: added at the front when absent,
 * removed when present (front = most recently pinned first).
 */
export function toggleFavorite(ids: string[], id: string): string[] {
  return ids.includes(id)
    ? ids.filter((existing) => existing !== id)
    : [id, ...ids];
}
