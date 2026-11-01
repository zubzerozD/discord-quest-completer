//! Reactive favorites bound to localStorage: loads once, persists on change.
import { ref } from "vue";
import type { Storage } from "../catalog/catalog";
import { loadFavorites, saveFavorites, toggleFavorite } from "./favorites";

const localStore: Storage = {
  get: (key) => localStorage.getItem(key),
  set: (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Quota exceeded: favorites are an optimization, never a hard failure.
    }
  },
};

export function useFavorites() {
  const ids = ref<string[]>(loadFavorites(localStore));

  function toggle(id: string): void {
    ids.value = toggleFavorite(ids.value, id);
    saveFavorites(localStore, ids.value);
  }

  function isFavorite(id: string): boolean {
    return ids.value.includes(id);
  }

  return { favoriteIds: ids, toggle, isFavorite };
}
