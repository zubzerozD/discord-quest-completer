//! Quest countdown logic: pure functions with an injected clock so the
//! 15-minute boundary rules are unit-testable without real waiting.
//! The UI owns scheduling (setInterval); this module owns the math.

/**
 * Discord quests require ~15 minutes of "playing".
 * `VITE_QUEST_DURATION_MS` overrides the duration (test/dev seam used by the
 * end-to-end probe; unset in normal use, so production is always 15 min).
 */
const override = Number(import.meta.env.VITE_QUEST_DURATION_MS);
export const QUEST_DURATION_MS =
  Number.isFinite(override) && override > 0 ? override : 15 * 60 * 1000;

/**
 * Remaining milliseconds until `deadline`, clamped at 0 so a stalled tab
 * that wakes up past the deadline shows 00:00, never negative time.
 */
export function remainingMs(deadline: number, now: number): number {
  return Math.max(0, deadline - now);
}

/** True once `now` has reached the deadline (complete at exactly zero). */
export function isComplete(deadline: number, now: number): boolean {
  return now >= deadline;
}

/** Deadline for a quest started at `startedAt`. */
export function questDeadline(startedAt: number): number {
  return startedAt + QUEST_DURATION_MS;
}

/** Formats milliseconds as `MM:SS` (e.g. 15:00, 07:31, 00:00). */
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
