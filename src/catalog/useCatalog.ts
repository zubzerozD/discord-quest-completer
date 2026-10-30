import { fetch } from "@tauri-apps/plugin-http";
import { computed, ref } from "vue";
import bundledRaw from "../assets/gamelist.json?raw";
import { loadCatalog, type CatalogSource, type GameEntry } from "./catalog";

export const DETECTABLE_URL = "https://discord.com/api/v10/applications/detectable";

const FETCH_TIMEOUT_MS = 8_000;

/** localStorage-backed storage adapter (persists in the WebView2 profile). */
const localStore = {
  get: (key: string) => localStorage.getItem(key),
  set: (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Quota exceeded: the cache is an optimization, never a hard failure.
    }
  },
};

/**
 * Loads the catalog on mount and exposes loading state, the winning tier
 * (live/cached/fallback), and the win32-filtered game list.
 */
export function useCatalog() {
  const games = ref<GameEntry[]>([]);
  const source = ref<CatalogSource | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const sourceLabel = computed(() => {
    switch (source.value) {
      case "live":
        return "Updated from Discord";
      case "cached":
        return "Offline — using saved copy";
      case "fallback":
        return "Offline — using bundled list";
      default:
        return null;
    }
  });

  async function refresh(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const result = await loadCatalog({
        fetchLive: async () => {
          const response = await fetch(DETECTABLE_URL, {
            method: "GET",
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          });
          if (!response.ok) {
            throw new Error(`detectable API returned ${response.status}`);
          }
          return (await response.json()) as unknown;
        },
        storage: localStore,
        bundledRaw,
        now: () => Date.now(),
      });
      games.value = result.games;
      source.value = result.source;
    } catch (e) {
      // loadCatalog never throws, but keep the UI honest if something else does.
      error.value = e instanceof Error ? e.message : String(e);
      source.value = "fallback";
    } finally {
      loading.value = false;
    }
  }

  return { games, source, sourceLabel, loading, error, refresh };
}
