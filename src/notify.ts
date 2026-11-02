//! OS notification helper (S5). Never throws: a denied permission or a
//! missing plugin must not break the auto-close flow that calls it.
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { QUEST_DURATION_MS } from "./timer/questTimer";

/** Human-readable played duration for the notification body. */
export function formatPlayedDuration(durationMs: number): string {
  const minutes = Math.round(durationMs / 60_000);
  if (minutes >= 1) {
    return `${minutes} minutes`;
  }
  return `${Math.max(1, Math.round(durationMs / 1_000))} seconds`;
}

export async function notifyQuestComplete(gameName: string): Promise<void> {
  try {
    let granted = false;
    try {
      granted = (await isPermissionGranted()) ?? false;
    } catch {
      granted = false;
    }
    if (!granted) {
      granted = (await requestPermission()) === "granted";
    }
    if (!granted) {
      return;
    }
    sendNotification({
      title: "Quest time complete",
      body: `${formatPlayedDuration(QUEST_DURATION_MS)} played as ${gameName}. The dummy game was closed.`,
    });
  } catch {
    // Notifications are best-effort; the timer flow must continue.
  }
}
