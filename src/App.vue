<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { cleanupGames, listRunning, playGame, stopGame } from "./backend";
import { pickExecutable, type GameEntry } from "./catalog/catalog";
import { createSearch, sortByName } from "./catalog/search";
import { useCatalog } from "./catalog/useCatalog";
import { playCompletionChime } from "./chime";
import { useFavorites } from "./favorites/useFavorites";
import { notifyQuestComplete } from "./notify";
import { useQuestTimer } from "./timer/useQuestTimer";

/** Caps rendered rows: the catalog holds 10k+ games; the DOM must not. */
const VISIBLE_LIMIT = 200;

const { games, sourceLabel, loading, error, refresh } = useCatalog();
const { favoriteIds, toggle, isFavorite } = useFavorites();

const query = ref("");
const playing = ref<Record<string, number>>({});
const playingNames = ref<Record<string, string>>({});
const actionError = ref<string | null>(null);

const sorted = computed(() => sortByName(games.value));
const search = computed(() => createSearch(sorted.value));
const results = computed(() => search.value(query.value));

const favorites = computed(() =>
  favoriteIds.value
    .map((id) => games.value.find((g) => g.id === id))
    .filter((g): g is GameEntry => g !== undefined),
);

/** Favorites that also match the current query (pinned section respects search). */
const pinnedVisible = computed(() => {
  const matched = new Set(results.value.map((g) => g.id));
  return favorites.value.filter((g) => matched.has(g.id));
});

const regularVisible = computed(() => {
  const pinnedIds = new Set(pinnedVisible.value.map((g) => g.id));
  return results.value.filter((g) => !pinnedIds.has(g.id));
});

const shownRegular = computed(() => regularVisible.value.slice(0, VISIBLE_LIMIT));

/** List of currently active games for the "Now Playing" card. */
const activeGames = computed(() => {
  return Object.keys(playing.value)
    .map((id) => {
      const game = games.value.find((g) => g.id === id);
      return {
        id,
        name: game?.name ?? playingNames.value[id] ?? "Unknown game",
        game,
      };
    });
});

function isPlaying(id: string): boolean {
  return id in playing.value;
}

/** S5: at 00:00 notify the user and auto-close the tracked dummy. */
async function onTimerExpired(appId: string): Promise<void> {
  const game = games.value.find((g) => g.id === appId);
  playCompletionChime();
  try {
    await stopGame(appId);
    const next = { ...playing.value };
    delete next[appId];
    playing.value = next;
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : String(e);
  }
  await notifyQuestComplete(game?.name ?? "the game");
}

const questTimer = useQuestTimer((appId) => {
  void onTimerExpired(appId);
});

function favoriteLabel(game: GameEntry): string {
  return `${isFavorite(game.id) ? "Unfavorite" : "Favorite"} ${game.name}`;
}

function unfavoriteLabel(game: GameEntry): string {
  return `Unfavorite ${game.name}`;
}

async function refreshRunning(): Promise<void> {
  const entries = await listRunning();
  playing.value = Object.fromEntries(entries);
}

async function onPlay(game: GameEntry): Promise<void> {
  const executable = pickExecutable(game);
  if (!executable) {
    actionError.value = `${game.name} has no Windows executable`;
    return;
  }

  // Concurrency guard: Discord only credits one quest at a time.
  const activeIds = Object.keys(playing.value);
  if (activeIds.length > 0) {
    const activeName = playingNames.value[activeIds[0]] ?? "another game";
    const confirmed = window.confirm(
      `"${activeName}" is already running.\n\n` +
      `Discord only credits one quest at a time. ` +
      `Stop it and start "${game.name}" instead?`,
    );
    if (!confirmed) return;
    // Stop all currently running games
    for (const id of activeIds) {
      try {
        await stopGame(id);
        questTimer.stop(id);
      } catch {
        // Best effort — continue stopping the rest.
      }
    }
    playing.value = {};
    playingNames.value = {};
  }

  actionError.value = null;
  try {
    const outcome = await playGame(game.id, executable.name, game.name);
    playing.value = { ...playing.value, [game.id]: outcome.pid };
    playingNames.value = { ...playingNames.value, [game.id]: game.name };
    questTimer.start(game.id);
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : String(e);
  }
}

async function onStop(game: GameEntry): Promise<void> {
  actionError.value = null;
  try {
    await stopGame(game.id);
    questTimer.stop(game.id);
    const next = { ...playing.value };
    delete next[game.id];
    playing.value = next;
    const nextNames = { ...playingNames.value };
    delete nextNames[game.id];
    playingNames.value = nextNames;
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : String(e);
  }
}

async function onStopById(appId: string): Promise<void> {
  const game = games.value.find((g) => g.id === appId);
  if (game) return onStop(game);
  // Fallback when the game isn't in the catalog (e.g. after a reload)
  actionError.value = null;
  try {
    await stopGame(appId);
    questTimer.stop(appId);
    const next = { ...playing.value };
    delete next[appId];
    playing.value = next;
    const nextNames = { ...playingNames.value };
    delete nextNames[appId];
    playingNames.value = nextNames;
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : String(e);
  }
}

const cleaning = ref(false);
const cleanupNote = ref("");

/** On-demand cleanup (S6): running games keep their folders. */
async function onCleanup(): Promise<void> {
  cleaning.value = true;
  actionError.value = null;
  cleanupNote.value = "";
  try {
    const removed = await cleanupGames();
    cleanupNote.value = removed.length
      ? `Removed ${removed.length} stale folder${removed.length > 1 ? "s" : ""}.`
      : "Nothing to clean up.";
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : String(e);
  } finally {
    cleaning.value = false;
  }
}

onMounted(() => {
  void refresh();
  void refreshRunning();
});

onBeforeUnmount(() => {
  questTimer.dispose();
});
</script>

<template>
  <main class="app">
    <header>
      <h1>Discord Quest Completer</h1>
      <p v-if="loading" class="status">Loading catalog…</p>
      <p v-else-if="error" class="status error">{{ error }}</p>
      <p v-else-if="sourceLabel" class="status">
        {{ sourceLabel }} · {{ games.length.toLocaleString() }} games
      </p>
      <p v-if="actionError" class="status error">{{ actionError }}</p>
      <p v-if="cleanupNote" class="status">{{ cleanupNote }}</p>
      <button
        class="cleanup"
        :disabled="cleaning"
        aria-label="Clean up stale game folders"
        @click="onCleanup"
      >
        {{ cleaning ? "Cleaning…" : "Clean up folders" }}
      </button>
    </header>

    <!-- ─── Active game card ─── -->
    <section v-if="activeGames.length" class="now-playing">
      <div v-for="entry in activeGames" :key="entry.id" class="active-card">
        <div class="active-header">
          <span class="active-indicator" />
          <span class="active-label">Now Playing</span>
        </div>
        <div class="active-body">
          <span class="active-name">{{ entry.name }}</span>
          <span
            v-if="questTimer.label(entry.id)"
            class="active-time"
          >
            {{ questTimer.label(entry.id) }}
          </span>
          <button class="stop-btn" @click="onStopById(entry.id)">Stop</button>
        </div>
        <div class="progress-track">
          <div
            class="progress-fill"
            :style="{ width: `${questTimer.progress(entry.id) * 100}%` }"
          />
        </div>
      </div>
    </section>

    <input
      v-model="query"
      class="search"
      type="search"
      placeholder="Search games…"
      aria-label="Search games"
    />

    <section v-if="pinnedVisible.length" class="pinned">
      <h2>Favorites</h2>
      <ul>
        <li v-for="game in pinnedVisible" :key="game.id">
          <button
            class="star active"
            :aria-label="unfavoriteLabel(game)"
            @click="toggle(game.id)"
          >
            ★
          </button>
          <span class="name">{{ game.name }}</span>
          <span
            v-if="isPlaying(game.id) && questTimer.label(game.id)"
            class="countdown"
            :aria-label="`Quest timer ${questTimer.label(game.id)}`"
          >
            ⏱ {{ questTimer.label(game.id) }}
          </span>
          <button
            class="play"
            :disabled="!pickExecutable(game)"
            @click="isPlaying(game.id) ? onStop(game) : onPlay(game)"
          >
            {{ isPlaying(game.id) ? "Stop" : "Play" }}
          </button>
        </li>
      </ul>
    </section>

    <section class="results">
      <p v-if="!results.length && query" class="empty">
        No games match "{{ query }}".
      </p>
      <ul>
        <li v-for="game in shownRegular" :key="game.id">
          <button
            class="star"
            :class="{ active: isFavorite(game.id) }"
            :aria-label="favoriteLabel(game)"
            @click="toggle(game.id)"
          >
            {{ isFavorite(game.id) ? "★" : "☆" }}
          </button>
          <span class="name">{{ game.name }}</span>
          <span
            v-if="isPlaying(game.id) && questTimer.label(game.id)"
            class="countdown"
            :aria-label="`Quest timer ${questTimer.label(game.id)}`"
          >
            ⏱ {{ questTimer.label(game.id) }}
          </span>
          <button
            class="play"
            :disabled="!pickExecutable(game)"
            @click="isPlaying(game.id) ? onStop(game) : onPlay(game)"
          >
            {{ isPlaying(game.id) ? "Stop" : "Play" }}
          </button>
        </li>
      </ul>
      <p v-if="regularVisible.length > shownRegular.length" class="status">
        Showing {{ shownRegular.length.toLocaleString() }} of
        {{ regularVisible.length.toLocaleString() }} — refine your search.
      </p>
    </section>
  </main>
</template>

<style scoped>
.app {
  padding: 2rem;
  max-width: 720px;
  margin: 0 auto;
}
.status {
  color: #b5bac1;
  font-size: 0.9rem;
}
.status.error {
  color: #f23f43;
}

/* ─── Active game card ─── */
.now-playing {
  margin: 1rem 0;
}
.active-card {
  background: #2b2d31;
  border: 1px solid #5865f2;
  border-radius: 10px;
  padding: 0.8rem 1rem 0;
  margin-bottom: 0.5rem;
  overflow: hidden;
}
.active-header {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin-bottom: 0.45rem;
}
.active-indicator {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #57f287;
  animation: pulse-dot 2s ease-in-out infinite;
}
@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
.active-label {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #57f287;
  font-weight: 600;
}
.active-body {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-bottom: 0.7rem;
}
.active-name {
  flex: 1;
  font-size: 1.05rem;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.active-time {
  font-variant-numeric: tabular-nums;
  font-size: 1.3rem;
  font-weight: 700;
  color: #f2f3f5;
  white-space: nowrap;
}
.stop-btn {
  background: #f23f43;
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 0.35rem 1rem;
  font-size: 0.85rem;
  cursor: pointer;
  font-weight: 600;
}
.stop-btn:hover {
  background: #da373c;
}

/* ─── Progress bar ─── */
.progress-track {
  height: 4px;
  background: #1e1f22;
  margin: 0 -1rem;
  border-radius: 0 0 10px 10px;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #5865f2, #57f287);
  transition: width 0.3s linear;
  border-radius: 0 2px 2px 0;
}

/* ─── Search ─── */
.search {
  width: 100%;
  padding: 0.6rem 0.9rem;
  margin: 1rem 0;
  border: 1px solid #3f4147;
  border-radius: 8px;
  background: #2b2d31;
  color: #f2f3f5;
  font-size: 1rem;
}
.search:focus {
  outline: 2px solid #5865f2;
  border-color: transparent;
}
h2 {
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #b5bac1;
  margin: 1rem 0 0.4rem;
}
ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
li {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.35rem 0.5rem;
  border-radius: 6px;
}
li:hover {
  background: #2b2d31;
}
.name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.countdown {
  font-variant-numeric: tabular-nums;
  font-size: 0.85rem;
  color: #57f287;
  white-space: nowrap;
}
.star {
  background: none;
  border: none;
  font-size: 1.1rem;
  cursor: pointer;
  color: #b5bac1;
  padding: 0 0.2rem;
}
.star.active {
  color: #f0b232;
}
.play {
  background: #5865f2;
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 0.3rem 0.9rem;
  font-size: 0.85rem;
  cursor: pointer;
  min-width: 4.5rem;
}
.play:disabled {
  background: #4e5058;
  cursor: not-allowed;
}
.play:not(:disabled):hover {
  background: #4752c4;
}
.cleanup {
  background: none;
  border: 1px solid #3f4147;
  border-radius: 6px;
  color: #b5bac1;
  padding: 0.25rem 0.7rem;
  font-size: 0.8rem;
  cursor: pointer;
  margin-top: 0.35rem;
}
.cleanup:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
.cleanup:not(:disabled):hover {
  border-color: #5865f2;
  color: #f2f3f5;
}
.empty {
  color: #b5bac1;
  text-align: center;
  padding: 2rem 0;
}
</style>
