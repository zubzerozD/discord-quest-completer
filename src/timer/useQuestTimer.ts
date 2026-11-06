//! Reactive quest timer: one deadline per game, ticked on an interval.
//! Expiry fires exactly once per play session and calls back so the owner
//! can notify + auto-close (S5). The owner calls dispose() on teardown
//! (App.vue wires it to onBeforeUnmount) so the composable stays usable
//! outside component instances, e.g. under test.
import { ref } from "vue";
import {
  formatCountdown,
  isComplete,
  QUEST_DURATION_MS,
  questDeadline,
  remainingMs,
} from "./questTimer";

const TICK_MS = 250;

export function useQuestTimer(onExpire: (appId: string) => void) {
  /** appId -> quest deadline (epoch ms). */
  const deadlines = ref<Record<string, number>>({});
  /** Apps whose timer already fired for the current session. */
  const expired = new Set<string>();
  const now = ref(Date.now());

  function tick(): void {
    now.value = Date.now();
    for (const [appId, deadline] of Object.entries(deadlines.value)) {
      if (!expired.has(appId) && isComplete(deadline, now.value)) {
        expired.add(appId);
        onExpire(appId);
      }
    }
  }

  const interval = setInterval(tick, TICK_MS);

  /** Starts (or restarts) the 15-minute countdown for a game. */
  function start(appId: string): void {
    expired.delete(appId);
    deadlines.value = { ...deadlines.value, [appId]: questDeadline(now.value) };
  }

  /** Clears the countdown (user stopped early). */
  function stop(appId: string): void {
    expired.delete(appId);
    const next = { ...deadlines.value };
    delete next[appId];
    deadlines.value = next;
  }

  /** `MM:SS` label for a running timer, or null when the game has no timer. */
  function label(appId: string): string | null {
    const deadline = deadlines.value[appId];
    if (deadline === undefined) {
      return null;
    }
    return formatCountdown(remainingMs(deadline, now.value));
  }

  /** Progress 0→1 for the visual bar; 0 = just started, 1 = done. */
  function progress(appId: string): number {
    const deadline = deadlines.value[appId];
    if (deadline === undefined) return 0;
    const remaining = remainingMs(deadline, now.value);
    return Math.min(1, Math.max(0, 1 - remaining / QUEST_DURATION_MS));
  }

  /** Stops ticking; safe to call more than once. */
  function dispose(): void {
    clearInterval(interval);
  }

  return { deadlines, start, stop, label, progress, dispose };
}
